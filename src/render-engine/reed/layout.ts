/**
 * Tarak konum üreticisi: çözgülerin tezgahtaki merkezleri tarak dişlerinden gelir.
 *
 *  - Diş j kumaş koordinatında [j·p − p, (j+1)·p − p] aralığındadır (0. diş pencerenin hemen solunda
 *    başlar; düzgün üreticinin indekslemesiyle uyumlu). Diş teli her iki yanda wireRatio·p/2 yer
 *    kaplar; açıklık ortadadır.
 *  - Çözgüler tahar sırasıyla dolu dişlere dağılır (varsayılan: çözgü indeksi sırası).
 *  - Dişteki n telin çap toplamı açıklıktan küçükse teller n+1 eşit boşlukla yayılır (diş merkezine göre
 *    simetrik); büyükse teller diş açıklığına SIKIŞTIRILIR: merkezler çap oranında açıklık içine dizilir (Σ çap >
 *    açıklık → komşular üst üste biner; teller diş telinin dışına taşamaz). Kesitin sıkışıp yassılaşması ve hafif
 *    bindirme paketleme modelinde (realistic/packing.ts) ve klasik render'ın racetrack katmanında çizilir.
 *  - Σ çap > açıklık / 0.6 ise "bu dişe bu kadar tel sığmıyor" uyarısı.
 *  - Boş diş konumu boş bırakır: komşu teller arasında bir adım kadar fazladan boşluk oluşur.
 */
import { PeriodicPositionGenerator, lcm } from '../physical/positions';
import { deriveReed } from './derive';
import { placeInDent } from './dent';
import { IDENTITY_DRAWING_IN, type DrawingInPlan, type ReedSpec } from './types';

/** Tel sığmama eşiği: Σ çap > açıklık / FIT_LIMIT. */
export const FIT_LIMIT = 0.6;

export interface DentGeometry {
  /** Global diş indeksi. */
  index: number;
  /** Rapordaki yeri. */
  reportIndex: number;
  /** Dişin sınırları (mm, kumaş koordinatı). */
  left: number;
  right: number;
  /** Açıklık sınırları (diş telleri arası). */
  openLeft: number;
  openRight: number;
  center: number;
  /** Bu dişe düşen tel sayısı. */
  ends: number;
}

export interface OverfullDent {
  /** Periyot içindeki diş indeksi (1 tabanlı gösterim için +1 yapılır). */
  dent: number;
  ends: number;
  /** Σ çap (mm) ve açıklık (mm). */
  sumDiameterMm: number;
  openingMm: number;
}

export class ReedPositionGenerator extends PeriodicPositionGenerator {
  readonly pitchMm: number;
  readonly openingMm: number;
  readonly dentsPerPeriod: number;
  readonly report: number[];
  readonly startOffset: number;
  readonly derivedDensity: number;
  readonly overfull: OverfullDent[];
  /** Periyot içindeki k. çözgünün periyot içi diş indeksi. */
  private readonly dentOfLocal: Int32Array;

  constructor(
    spec: ReedSpec,
    diameterOf: (g: number) => number,
    diameterPeriod: number,
    drawingIn: DrawingInPlan = IDENTITY_DRAWING_IN,
  ) {
    const d = deriveReed(spec);
    const report = spec.dentingReport.map((n) => Math.max(0, Math.floor(n)));
    const L = report.length;
    const endsPerRepeat = report.reduce((a, b) => a + b, 0);
    const P = lcm(endsPerRepeat, Math.max(1, diameterPeriod));
    const repeats = P / endsPerRepeat;
    const dentsPerPeriod = repeats * L;
    const p = d.pitchMm;
    const open = d.openingMm;
    const off = ((Math.floor(spec.startOffset ?? 0) % L) + L) % L;
    const offsets = new Float64Array(P);
    const dentOfLocal = new Int32Array(P);
    const overfull: OverfullDent[] = [];
    let seq = 0; // tahar sırasındaki konum
    for (let j = 0; j < dentsPerPeriod; j++) {
      const n = report[(j + off) % L];
      if (n === 0) continue;
      const center = j * p - p + p / 2;
      const members: number[] = [];
      for (let t = 0; t < n; t++) members.push(seq + t);
      // Tahar planı: dağıtım sırasındaki konum → çözgü indeksi (özdeşlikte aynı)
      const warps = members.map((m) => warpAtSequence(drawingIn, m, P));
      const ds = warps.map((g) => diameterOf(g));
      // Ortak diş yerleştirme (reed/dent.ts): tarakta teller açıklığa yayılır, sığmazsa açıklığa sıkışır
      const pl = placeInDent(center, open, ds, 'spread');
      if (pl.sumDiameter > open / FIT_LIMIT) overfull.push({ dent: j, ends: n, sumDiameterMm: pl.sumDiameter, openingMm: open });
      warps.forEach((g, t) => {
        const local = ((g % P) + P) % P;
        offsets[local] = pl.centers[t];
        dentOfLocal[local] = j;
      });
      seq += n;
    }
    super(offsets, dentsPerPeriod * p);
    this.pitchMm = p;
    this.openingMm = open;
    this.dentsPerPeriod = dentsPerPeriod;
    this.report = report;
    this.startOffset = off;
    this.derivedDensity = d.loomWarpDensity;
    this.overfull = overfull;
    this.dentOfLocal = dentOfLocal;
  }

  /** Global diş j'nin geometrisi. */
  dentAt(j: number): DentGeometry {
    const p = this.pitchMm;
    const L = this.report.length;
    const reportIndex = (((j + this.startOffset) % L) + L) % L;
    const left = j * p - p;
    const wire = (p - this.openingMm) / 2;
    return {
      index: j,
      reportIndex,
      left,
      right: left + p,
      openLeft: left + wire,
      openRight: left + p - wire,
      center: left + p / 2,
      ends: this.report[reportIndex],
    };
  }

  /** Genel diş kaynağı arayüzü (physical/warpLayout.ts DentSource): tel g'nin dişi. */
  dentOf(g: number): number {
    return this.dentOfWarp(g);
  }

  /** Global çözgü g'nin dişi. */
  dentOfWarp(g: number): number {
    const P = this.period;
    const q = Math.floor(g / P);
    return q * this.dentsPerPeriod + this.dentOfLocal[g - q * P];
  }

  /** [x0, x1] mm aralığına düşen dişler. */
  dentRange(x0Mm: number, x1Mm: number): { first: number; last: number } {
    const p = this.pitchMm;
    return { first: Math.floor((x0Mm + p) / p), last: Math.floor((x1Mm + p) / p) };
  }
}

/** Dağıtım sırasındaki m. konuma düşen çözgü (tahar planının tersi; özdeşlikte m). */
function warpAtSequence(plan: DrawingInPlan, m: number, P: number): number {
  if (plan === IDENTITY_DRAWING_IN) return m;
  for (let g = 0; g < P; g++) if (((plan.dentSequenceIndex(g) % P) + P) % P === m) return g;
  return m;
}
