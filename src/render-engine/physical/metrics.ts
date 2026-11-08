/**
 * Kumaş metrikleri. Karşılık: reference/weave_phys.py "metrikler" bölümü.
 * Açıklık % render'dan gelir (arka plan piksel oranı); diğerleri burada hesaplanır.
 */
import type { FabricSpec } from '../types';
import { finishedDensities } from './shrinkage';
import { UniformPositionGenerator } from './positions';
import { MIN_SQUEEZE, ashenhurstMax, squeeze } from './squeeze';
import { slotIndices, slotTable } from './yarns';

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
  /** Kıvrım % (Peirce yaklaşığı). */
  crimpWarp: number;
  crimpWeft: number;
  /** Kıvrımlı gramaj (g/m²). */
  gsm: number;
  /** Ashenhurst sıkışma oranı % = sıklık / teorik max. */
  jamWarp: number;
  jamWeft: number;
  maxWarp: number;
  maxWeft: number;
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

export interface SqueezeCheck {
  /** Bir rapor döngüsünde en küçük genişlik ölçeği (s). */
  minScaleWarp: number;
  minScaleWeft: number;
  /** "Sıkıştı" (s < 0.55): asıl hata durumu. */
  jammedWarp: boolean;
  jammedWeft: boolean;
}

/** Görünüm penceresinden bağımsız sıkışma kontrolü: rapor dizisinin iki döngüsü üzerinde squeeze. */
export function squeezeCheck(spec: FabricSpec): SqueezeCheck {
  const { warp: Dw, weft: Df } = finishedDensities(
    spec.warpDensityLoom,
    spec.weftDensityLoom,
    spec.warpShrinkPct,
    spec.weftShrinkPct,
  );
  const run = (slots: FabricSpec['warpSlots'], seq: number[], D: number) => {
    const t = slotTable(slots);
    const n = Math.max(2, (seq.length || 1) * 2 + 1);
    const pos = new UniformPositionGenerator(D);
    const idx = slotIndices(seq, 0, n, slots.length);
    const r = Array.from(idx, (s) => t.diameter[s] / 2);
    // alt sınıra kırpılmamış ölçeği görmek için minScale = 0
    const raw = squeeze(pos.centers(0, n), r, 0);
    let min = 1;
    for (const s of raw.width) min = Math.min(min, s);
    return { min, jammed: min < MIN_SQUEEZE };
  };
  const w = run(spec.warpSlots, spec.warpSequence, Dw);
  const f = run(spec.weftSlots, spec.weftSequence, Df);
  return { minScaleWarp: w.min, minScaleWeft: f.min, jammedWarp: w.jammed, jammedWeft: f.jammed };
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

export function computeMetrics(spec: FabricSpec, opts: MetricsOptions = {}): FabricMetrics {
  const { warp: Dw, weft: Df } = finishedDensities(
    spec.warpDensityLoom,
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
  const hW = ((dw + df) / 2) * beta;
  const hF = ((dw + df) / 2) * (1 - beta);
  const crimpW = (8 / 3) * (hW / (10 / Df)) ** 2 * (aw.I / aw.E);
  const crimpF = (8 / 3) * (hF / (10 / Dw)) ** 2 * (af.I / af.E);
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
