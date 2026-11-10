/**
 * Faz 4: doğal düzensizlik (iplik başına, tohumlu, deterministik).
 *  - kalınlık: r × (1 + t·thicknessPct/100), t ∈ [−1, 1]
 *  - konum kayması: merkez + t·positionPct/100·aralık
 *  - renk sapması: OKLab'de ağırlıklı (L 1, a 0.4, b 0.4) → toplam |Δ| ≤ colorDeltaE/100
 *    (OKLab ×100 ölçeğinde ΔE; ΔE ≈ 1 zor fark edilir, 2–3 hafif ton farkı).
 *    VARSAYIM: iplikten ipliğe fark çoğunlukla açıklıkta, renk tonunda az (boyama partisi farkı).
 * Aynı girdi + aynı tohum → birebir aynı değerler (GLSL ve JS aynı hash).
 * VARSAYIM (kalibre edilecek): varsayılanlar kalınlık %4, konum %5, renk ΔE 1.5.
 */
import { CH_COLOR_A, CH_COLOR_B, CH_COLOR_L, CH_POSITION, CH_THICKNESS, threadRand } from './hash';
import type { FabricInput, Irregularity } from './types';

export const DEFAULT_IRREGULARITY: Required<Irregularity> = { thicknessPct: 4, colorDeltaE: 1.5, positionPct: 5 };
export const DEFAULT_SEED = 1;

export interface ResolvedIrregularity {
  seed: number;
  thickness: number; // oran (0.04 = %4)
  position: number; // aralık oranı
  colorDeltaE: number; // OKLab×100
}

/** Girdi + genel çarpan (Tuning.irregularity, varsayılan 1) → etkin değerler. */
export function resolveIrregularity(input: FabricInput, multiplier = 1): ResolvedIrregularity {
  const ir = { ...DEFAULT_IRREGULARITY, ...(input.irregularity ?? {}) };
  const m = Math.max(0, multiplier);
  return {
    seed: (input.seed ?? DEFAULT_SEED) >>> 0,
    thickness: (m * ir.thicknessPct) / 100,
    position: (m * ir.positionPct) / 100,
    colorDeltaE: m * ir.colorDeltaE,
  };
}

export const NO_IRREGULARITY: Irregularity = { thicknessPct: 0, colorDeltaE: 0, positionPct: 0 };

export function thicknessScale(axis: 0 | 1, index: number, r: ResolvedIrregularity): number {
  return 1 + r.thickness * threadRand(axis, index, CH_THICKNESS, r.seed);
}

export function positionOffset(axis: 0 | 1, index: number, pitchMm: number, r: ResolvedIrregularity): number {
  return r.position * pitchMm * threadRand(axis, index, CH_POSITION, r.seed);
}

/* ---------- OKLab (Björn Ottosson) — doğrusal sRGB ↔ OKLab ---------- */

export function linearToOklab([r, g, b]: [number, number, number]): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToLinear([L, a, b]: [number, number, number]): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** OKLab kanal ağırlıkları (L, a, b) ve normu: |Δ| ≤ ΔE için k = ΔE / (100·|w|). */
export const COLOR_WEIGHTS: [number, number, number] = [1, 0.4, 0.4];
const COLOR_NORM = Math.hypot(...COLOR_WEIGHTS);

/** İpliğin OKLab renk sapması (shader ile aynı). */
export function colorOffsetOklab(axis: 0 | 1, index: number, r: ResolvedIrregularity): [number, number, number] {
  const k = r.colorDeltaE / (100 * COLOR_NORM);
  return [
    k * COLOR_WEIGHTS[0] * threadRand(axis, index, CH_COLOR_L, r.seed),
    k * COLOR_WEIGHTS[1] * threadRand(axis, index, CH_COLOR_A, r.seed),
    k * COLOR_WEIGHTS[2] * threadRand(axis, index, CH_COLOR_B, r.seed),
  ];
}
