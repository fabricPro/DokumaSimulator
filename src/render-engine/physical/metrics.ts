/**
 * Kumaş metrikleri. Karşılık: reference/weave_phys.py "metrikler" bölümü, iki farkla:
 *  - Ashenhurst sıkışma oranı yanal bağlantıyla (I = Σ w_k) hesaplanır; referans eksenleri ters
 *    sayıyordu (bkz. squeeze.ts). Kıvrım için iplik boyunca bağlantı kullanılmaya devam eder.
 *  - Konum tabanlı metrikler: çekmenin ulaşılabilirliği, en büyük gözenek, ortalama grup genişliği.
 * Açıklık % render'dan gelir (arka plan piksel oranı).
 */
import type { FabricSpec } from '../types';
import { finishedDensities } from './shrinkage';
import { alongYarnInterlacing, ashenhurstMax } from './squeeze';
import { buildFabricPositions, type AxisPositions, type FabricPositions } from './shrinkDistribution';
import { racetrack } from './simulate';
import { slotTable } from './yarns';

export type WarningLevel = 'ok' | 'warn' | 'high';

export interface FabricMetrics {
  /** Mamul çözgü sıklığı (tel/cm). */
  Dw: number;
  /** Mamul atkı sıklığı (atkı/cm). */
  Df: number;
  /** Örtme faktörü % = 100·(1 − (1−cw)(1−cf)). */
  cover: number;
  coverWarp: number;
  coverWeft: number;
  /** Kıvrım % (Peirce yaklaşığı, iplik boyunca bağlantı). */
  crimpWarp: number;
  crimpWeft: number;
  /** Kıvrımlı gramaj (g/m²). */
  gsm: number;
  /** Ashenhurst sıkışma oranı % = sıklık / teorik max (yanal bağlantı). */
  jamWarp: number;
  jamWeft: number;
  maxWarp: number;
  maxWeft: number;
  /** Ashenhurst E/I (yanal). */
  E_w: number;
  I_w: number;
  E_f: number;
  I_f: number;
  /** Ortalama çap (mm). */
  dWarp: number;
  dWeft: number;
  /** Sıkışma uyarı seviyeleri: >%100 sarı, >%115 kırmızı (kesin sınır değil). */
  jamLevelWarp: WarningLevel;
  jamLevelWeft: WarningLevel;
}

export interface MetricsOptions {
  /**
   * Ortalama çap/tex hangi ipliklerden alınır (slot indeksleri).
   * Verilmezse rapor dizisinin bir döngüsü kullanılır (pencereden bağımsız).
   * Referansla birebir karşılaştırmada penceredeki iplikler (simulate sonucu) verilir.
   */
  warpSlotsUsed?: ArrayLike<number>;
  weftSlotsUsed?: ArrayLike<number>;
  /** yarnDensity verilmemiş slotlar için varsayılan iplik yoğunluğu (kalibrasyon; normalde 0.85). */
  defaultYarnDensity?: number;
  /** Kıvrım payını ezer (kalibrasyon). */
  warpCrimpShareOverride?: number;
}

export function jamLevel(pct: number): WarningLevel {
  if (pct > 115) return 'high';
  if (pct > 100) return 'warn';
  return 'ok';
}

function mean(values: Float64Array, idx: ArrayLike<number>): number {
  let s = 0;
  for (let k = 0; k < idx.length; k++) s += values[idx[k]];
  return s / idx.length;
}

/** Tarak varsa taraktan türetilen, yoksa girilen tezgah çözgü sıklığı. */
export function effectiveLoomWarpDensity(spec: FabricSpec, positions?: FabricPositions): number {
  const p = positions ?? (spec.reed ? buildFabricPositions(spec) : undefined);
  return p?.reedDensity ?? spec.warpDensityLoom;
}

export function computeMetrics(spec: FabricSpec, opts: MetricsOptions = {}): FabricMetrics {
  const { warp: Dw, weft: Df } = finishedDensities(
    effectiveLoomWarpDensity(spec),
    spec.weftDensityLoom,
    spec.warpShrinkPct,
    spec.weftShrinkPct,
  );
  const beta = opts.warpCrimpShareOverride ?? spec.warpCrimpShare ?? 0.4;
  const wt = slotTable(spec.warpSlots, opts.defaultYarnDensity);
  const ft = slotTable(spec.weftSlots, opts.defaultYarnDensity);
  const wIdx = opts.warpSlotsUsed ?? (spec.warpSequence.length ? spec.warpSequence : [0]);
  const fIdx = opts.weftSlotsUsed ?? (spec.weftSequence.length ? spec.weftSequence : [0]);

  const dw = mean(wt.diameter, wIdx);
  const df = mean(ft.diameter, fIdx);
  const cw = Math.min(1, (Dw / 10) * dw);
  const cf = Math.min(1, (Df / 10) * df);
  const aw = ashenhurstMax(spec.weave, 'warp', dw);
  const af = ashenhurstMax(spec.weave, 'weft', df);
  const crW = alongYarnInterlacing(spec.weave, 'warp');
  const crF = alongYarnInterlacing(spec.weave, 'weft');
  const hW = ((dw + df) / 2) * beta;
  const hF = ((dw + df) / 2) * (1 - beta);
  const crimpW = (8 / 3) * (hW / (10 / Df)) ** 2 * (crW.I / crW.E);
  const crimpF = (8 / 3) * (hF / (10 / Dw)) ** 2 * (crF.I / crF.E);
  const gsm =
    ((Dw * 100 * mean(wt.tex, wIdx)) / 1000) * (1 + crimpW) + ((Df * 100 * mean(ft.tex, fIdx)) / 1000) * (1 + crimpF);
  const jamWarp = (100 * Dw) / aw.max;
  const jamWeft = (100 * Df) / af.max;
  return {
    Dw,
    Df,
    cover: 100 * (1 - (1 - cw) * (1 - cf)),
    coverWarp: 100 * cw,
    coverWeft: 100 * cf,
    crimpWarp: 100 * crimpW,
    crimpWeft: 100 * crimpF,
    gsm,
    jamWarp,
    jamWeft,
    maxWarp: aw.max,
    maxWeft: af.max,
    E_w: aw.E,
    I_w: aw.I,
    E_f: af.E,
    I_f: af.I,
    dWarp: dw,
    dWeft: df,
    jamLevelWarp: jamLevel(jamWarp),
    jamLevelWeft: jamLevel(jamWeft),
  };
}

/* ------------------------------------------------------------------ */
/* Konum tabanlı metrikler                                              */
/* ------------------------------------------------------------------ */

export interface AxisStructure {
  /** İplikler arası en büyük açık aralık (mm). */
  maxClearMm: number;
  /** Ortalama grup genişliği (mm): birbirine değen ardışık ipliklerin kapladığı genişlik. */
  meanGroupWidthMm: number;
  /** Periyottaki grup sayısı. */
  groups: number;
  /** Açık aralıkların toplam genişliğe oranı (0..1), izdüşüm. */
  openFraction: number;
}

export interface StructureMetrics {
  warp: AxisStructure;
  weft: AxisStructure;
  /** En büyük gözenek: çözgü yönündeki × atkı yönündeki açık aralık (mm). */
  poreMm: [number, number];
  /** Analitik açıklık % = çözgü açıklık oranı × atkı açıklık oranı (izdüşüm; kalibrasyon için). */
  openPctAnalytic: number;
  feasible: boolean;
  /** Ulaşılabilen en büyük çekme (%): çözgü yönünde (boy) ve atkı yönünde (en). */
  maxWarpShrinkPct: number;
  maxWeftShrinkPct: number;
  /** "Sıkıştı": tezgahta zaten 0.55·(r+r)'den dar aralık (tarak zorlaması). */
  jammedWarp: boolean;
  jammedWeft: boolean;
  warnings: string[];
}

/** Değme toleransı: açık aralık bundan küçükse iplikler aynı grupta sayılır (çapın oranı). */
const TOUCH_TOL = 0.02;

function axisStructure(ax: AxisPositions): AxisStructure {
  const P = ax.period;
  const gen = ax.finished;
  // Döngüsel komşuluk için iki kenar ipliği ekle: g = −1 .. P
  const c = gen.centers(-1, P + 2);
  const r = new Float64Array(P + 2);
  for (let k = 0; k < P + 2; k++) r[k] = ax.radii[(((k - 1) % P) + P) % P];
  const rt = racetrack(c, r);
  let maxClear = 0;
  let clearSum = 0;
  const clear = new Float64Array(P);
  for (let k = 0; k < P; k++) {
    const a = k + 1;
    const cl = Math.max(0, c[a + 1] - c[a] - rt.aHigh[a] - rt.aLow[a + 1]);
    clear[k] = cl;
    clearSum += cl;
    if (cl > maxClear) maxClear = cl;
  }
  const width = c[P + 1] - c[1];
  // Gruplar: açık aralığı toleranstan büyük olan aralıklar sınırdır
  const breaks: number[] = [];
  for (let k = 0; k < P; k++) if (clear[k] > TOUCH_TOL * 2 * r[k + 1]) breaks.push(k);
  let meanGroup: number;
  let groups: number;
  if (breaks.length === 0) {
    groups = 1;
    meanGroup = width;
  } else {
    groups = breaks.length;
    // Her grup: bir sınırdan sonraki iplikten bir sonraki sınıra kadar, kenarlardan kenara
    let total = 0;
    for (let b = 0; b < breaks.length; b++) {
      const startYarn = breaks[b] + 1; // periyot içi iplik indeksi
      const endYarn = b + 1 < breaks.length ? breaks[b + 1] : breaks[0] + P;
      const left = gen.centers(startYarn, 1)[0] - ax.radii[startYarn % P];
      const right = gen.centers(endYarn, 1)[0] + ax.radii[endYarn % P];
      total += right - left;
    }
    meanGroup = total / groups;
  }
  return { maxClearMm: maxClear, meanGroupWidthMm: meanGroup, groups, openFraction: width > 0 ? clearSum / width : 0 };
}

export function structureMetrics(spec: FabricSpec, positions?: FabricPositions): StructureMetrics {
  const pos = positions ?? buildFabricPositions(spec);
  const warp = axisStructure(pos.warp);
  const weft = axisStructure(pos.weft);
  const warnings = [...pos.warnings];
  if (!pos.warp.feasible) {
    warnings.push(
      `Atkı çekmesi %${spec.weftShrinkPct} bu örgü ve iplikle fiziksel olarak mümkün değil; ulaşılabilen en fazla %${pos.warp.maxShrinkPct.toFixed(1)}.`,
    );
  }
  if (!pos.weft.feasible) {
    warnings.push(
      `Çözgü çekmesi %${spec.warpShrinkPct} bu örgü ve iplikle fiziksel olarak mümkün değil; ulaşılabilen en fazla %${pos.weft.maxShrinkPct.toFixed(1)}.`,
    );
  }
  const share = spec.warpCrimpShare ?? 0.4;
  if (share >= 0.999) warnings.push('Kıvrım payı 1.00: atkı kıvrımı sıfır, görünüm gerçekçi olmayabilir.');
  if (share <= 0.001) warnings.push('Kıvrım payı 0.00: çözgü kıvrımı sıfır, görünüm gerçekçi olmayabilir.');
  return {
    warp,
    weft,
    poreMm: [warp.maxClearMm, weft.maxClearMm],
    openPctAnalytic: 100 * warp.openFraction * weft.openFraction,
    feasible: pos.warp.feasible && pos.weft.feasible,
    maxWarpShrinkPct: pos.weft.maxShrinkPct,
    maxWeftShrinkPct: pos.warp.maxShrinkPct,
    jammedWarp: pos.warp.loomJammed,
    jammedWeft: pos.weft.loomJammed,
    warnings,
  };
}
