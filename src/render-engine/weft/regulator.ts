/**
 * Atkı regülatörü (DOB "R", PID "S"): tarağın atkı yönündeki karşılığı.
 *
 * Regülatörlü atkıda makine çözgü salmayı ve kumaş sarmayı durdurur; o atkı bir önceki atkının hizasına atılır.
 * Model: her NORMAL atkı (N) yeni bir "atkı dişi" açar, REGÜLATÖRLÜ atkı (R) bir önceki atkının dişine eklenir.
 *  - Atkı dişi aralığı p = 10 / makine sıklığı (mm); dişteki atkılar temasla yan yana, diş merkezine ortalı
 *    (reed/dent.ts placeInDent 'contact'); toplam çap p'yi aşarsa çaplar p'ye ölçeklenir ve "Atkı sıkıştı" uyarısı.
 *  - Etkin sıklık = makine sıklığı × L / (L − R sayısı).
 *  - Rapor kumaş boyunca tekrarlanır (periyot = lcm(L, atkı dizisi)). Rapor başındaki R'ler bir önceki tekrarın son
 *    dişine bağlanır (sarma); art arda R'ler aynı dişe girer.
 *  - Köken UniformPositionGenerator ile aynı: diş j'nin merkezi j·p − p/2 (atkı g'nin eşit aralıktaki yeri
 *    (g + 0.5)·p − p). Diş duvarları (left / right) paketlemeye ve düzensizlik sınırına gider (warpLayout DentSource).
 */
import { PeriodicPositionGenerator, lcm } from '../physical/positions';
import { placeInDent } from '../reed/dent';

export type RegulatorToken = 'N' | 'R';

export type RegulatorParse = { ok: true; report: RegulatorToken[] } | { ok: false; error: string };

/** "N R R N R R", "NRRNRR", "N-R-R" (R = DOB regülatör, S = PID; büyük / küçük harf serbest). */
export function parseRegulator(text: string): RegulatorParse {
  const t = text.trim();
  if (t === '') return { ok: false, error: 'Regülatör raporu boş.' };
  const report: RegulatorToken[] = [];
  for (const ch of t.toUpperCase()) {
    if (/[\s,;\-_]/.test(ch)) continue;
    if (ch === 'N') report.push('N');
    else if (ch === 'R' || ch === 'S') report.push('R');
    else return { ok: false, error: `Geçersiz karakter "${ch}": yalnız N (normal) ve R (regülatör) kullanın.` };
  }
  if (report.length === 0) return { ok: false, error: 'Regülatör raporu boş.' };
  return { ok: true, report };
}

export interface RegulatorStats {
  /** Rapor uzunluğu (atkı). */
  L: number;
  /** Regülatörlü (R) ve normal (N) atkı sayısı. */
  R: number;
  N: number;
  /** En az bir normal atkı var mı (R sayısı = L ise geçersiz). */
  valid: boolean;
  /** Etkin / makine sıklığı = L / N (geçersizse 1). */
  ratio: number;
}

export function regulatorStats(report: ReadonlyArray<RegulatorToken> | undefined): RegulatorStats {
  const L = report?.length ?? 0;
  const R = report ? report.filter((x) => x === 'R').length : 0;
  const N = L - R;
  return { L, R, N, valid: L > 0 && N > 0, ratio: L > 0 && N > 0 ? L / N : 1 };
}

/** Geçerli regülatör raporu (yoksa / geçersizse undefined). */
export function activeRegulator(report: ReadonlyArray<RegulatorToken> | undefined): RegulatorToken[] | undefined {
  return report && regulatorStats(report).valid ? [...report] : undefined;
}

/** Etkin atkı sıklığı (atkı/cm) = makine × L / (L − R). */
export function regulatorEffectiveDensity(machinePerCm: number, report: ReadonlyArray<RegulatorToken> | undefined): number {
  return machinePerCm * regulatorStats(report).ratio;
}

export interface RegulatorDent {
  index: number;
  left: number;
  right: number;
  center: number;
  /** Bu dişteki atkı sayısı (rapordan). */
  picks: number;
}

export interface OverfullRegulatorDent {
  dent: number;
  picks: number;
  sumDiameterMm: number;
  openingMm: number;
}

export class WeftRegulatorGenerator extends PeriodicPositionGenerator {
  readonly pitchMm: number;
  readonly report: RegulatorToken[];
  readonly L: number;
  readonly N: number;
  readonly dentsPerPeriod: number;
  /** Etkin sıklık (atkı/cm). */
  readonly derivedDensity: number;
  readonly overfull: OverfullRegulatorDent[];
  private readonly cumN: Int32Array;

  /**
   * @param machinePerCm makine sıklığı (dişler / cm)
   * @param diameterOf   global atkı g'nin çapı (mm)
   * @param diameterPeriod atkı renk / iplik dizisi uzunluğu (periyot = lcm(L, bu))
   */
  constructor(machinePerCm: number, report: RegulatorToken[], diameterOf: (g: number) => number, diameterPeriod: number) {
    if (!(machinePerCm > 0)) throw new Error(`Geçersiz makine sıklığı: ${machinePerCm}`);
    const st = regulatorStats(report);
    if (!st.valid) throw new Error('Regülatör raporunda en az bir normal (N) atkı olmalı.');
    const L = st.L;
    const N = st.N;
    const cumN = new Int32Array(L);
    let c = 0;
    for (let k = 0; k < L; k++) {
      if (report[k] === 'N') c++;
      cumN[k] = c;
    }
    const P = lcm(L, Math.max(1, diameterPeriod));
    const repeats = P / L;
    const D = N * repeats; // periyottaki diş sayısı
    const p = 10 / machinePerCm;
    const widthMm = D * p;
    // Global g'nin dişi: önceki tekrarın son dişine sarma (rapor başı R → cumN = 0 → q·N − 1)
    const dentOfG = (g: number) => Math.floor(g / L) * N + cumN[((g % L) + L) % L] - 1;
    const lead = report.indexOf('N'); // rapor başındaki R sayısı
    // Üyeler: periyottaki g'ler + bir sonraki periyodun baştaki R'leri (son dişin üyesi)
    const members = new Map<number, number[]>();
    for (let g = 0; g < P + lead; g++) {
      const j = dentOfG(g);
      if (j < 0) continue; // periyot başındaki R'ler: önceki periyodun son dişinin üyesi (g + P olarak eklenir)
      const m = members.get(j);
      if (m) m.push(g);
      else members.set(j, [g]);
    }
    const offsets = new Float64Array(P);
    const overfull: OverfullRegulatorDent[] = [];
    for (const [j, gs] of members) {
      const pl = placeInDent(j * p - p / 2, p, gs.map(diameterOf), 'contact');
      if (!pl.fits && j >= 0 && j < D) overfull.push({ dent: j, picks: gs.length, sumDiameterMm: pl.sumDiameter, openingMm: p });
      gs.forEach((g, t) => {
        if (g < P) offsets[g] = pl.centers[t];
        else offsets[g - P] = pl.centers[t] - widthMm; // sonraki periyodun baştaki R'leri
      });
    }
    super(offsets, widthMm);
    this.pitchMm = p;
    this.report = [...report];
    this.L = L;
    this.N = N;
    this.dentsPerPeriod = D;
    this.derivedDensity = machinePerCm * st.ratio;
    this.overfull = overfull.sort((a, b) => a.dent - b.dent);
    this.cumN = cumN;
  }

  /** Global atkı g'nin dişi (rapor başı R için önceki tekrarın son dişi). */
  dentOf(g: number): number {
    return Math.floor(g / this.L) * this.N + this.cumN[((g % this.L) + this.L) % this.L] - 1;
  }

  /** Global diş j'nin geometrisi (diş j: [j·p − p, j·p]). */
  dentAt(j: number): RegulatorDent {
    const p = this.pitchMm;
    let picks = 0;
    // rapordaki N'ler j'ye karşılık gelen N'den sonra gelen R'ler: dişin atkı sayısı
    const q = Math.floor(j / this.N);
    const nIdx = j - q * this.N; // rapor içindeki (nIdx + 1). N
    let seen = -1;
    for (let k = 0; k < this.L; k++) {
      if (this.report[k] === 'N') seen++;
      if (seen === nIdx) picks++;
      else if (seen > nIdx) break;
    }
    // rapor başındaki R'ler son dişe aittir
    if (nIdx === this.N - 1) picks += this.report.indexOf('N');
    return { index: j, left: j * p - p, right: j * p, center: j * p - p / 2, picks };
  }
}
