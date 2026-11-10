/**
 * FabricInput → döşeme periyodunda iplik yerleşimi (saf): merkez kayması (eşit aralığa göre) ve paketlenmiş kesit
 * en/boyu. GPU iplik tablosu (pack.ts threadTable satır 0) ve CPU ikizi (geometry.ts v2) aynı sonucu kullanır.
 *
 *  - `input.positions` varsa (tarak / çekme yay modeli) merkezler oradan; yoksa eşit aralık (i + 0.5)·p.
 *    Ortalama aralık p = 10 / sıklık; adaptör sıklığı periyottan verir (merkez sayısı / periyot).
 *  - Kesit: packing.ts packAxis (hücre = komşu orta noktaları, boş diş sınırı; hacim korunur).
 */
import { DEFAULT_YARN_DENSITY, diameterMm, toTex } from './yarn';
import { packAxis, packKind, resolvePacking, type PackingOverrides, type PackKind } from './packing';
import { pitchMm } from './scale';
import type { FabricInput } from './types';

export interface InputAxisLayout {
  /** Merkez kayması (mm): c_k − (k + 0.5)·p, k = 0 .. periyot − 1. */
  offset: Float64Array;
  /** Kesit en/boy A = (w/d)². */
  aspect: Float64Array;
  /** Yuvarlak çap (mm). */
  diameter: Float64Array;
  pitch: number;
  /** Komşu merkezler arası en küçük aralık (mm) ve en geniş yarı kesit (mm): aday penceresi için. */
  minGap: number;
  maxHalfWidth: number;
  /** Açık izdüşüm oranı (0..1). */
  clearFraction: number;
}

/** Konum tablosunun periyodu (iplik); yoksa 1. */
export function positionsPeriod(input: FabricInput, ax: 0 | 1): number {
  const t = ax === 0 ? input.positions?.warp : input.positions?.weft;
  return t ? t.centersMm.length : 1;
}

export function axisLayout(input: FabricInput, ax: 0 | 1, period: number, packing?: PackingOverrides, spread = 1): InputAxisLayout {
  const list = ax === 0 ? input.warp : input.weft;
  const pitch = pitchMm(ax === 0 ? input.density.warpPerCm : input.density.weftPerCm);
  const pos = ax === 0 ? input.positions?.warp : input.positions?.weft;
  const centers = new Float64Array(period);
  const limitL = pos?.limitLMm ? new Float64Array(period) : undefined;
  const limitR = pos?.limitRMm ? new Float64Array(period) : undefined;
  if (pos && period % pos.centersMm.length === 0) {
    const P0 = pos.centersMm.length;
    // mm konumları tablodaki gibi (adaptör: eşit aralıkta i = 0 → 0.5·p); sıklık = P0 / periyot olmalı
    for (let k = 0; k < period; k++) {
      const q = Math.floor(k / P0);
      centers[k] = q * pos.periodMm + pos.centersMm[k - q * P0];
      if (limitL) limitL[k] = pos.limitLMm![k - q * P0];
      if (limitR) limitR[k] = pos.limitRMm![k - q * P0];
    }
  } else {
    for (let k = 0; k < period; k++) centers[k] = (k + 0.5) * pitch;
  }
  const diameter = new Float64Array(period);
  const kinds: PackKind[] = [];
  for (let k = 0; k < period; k++) {
    const y = input.yarnTypes[list[k % list.length].yarnType];
    diameter[k] = diameterMm(toTex(y.count, y.unit), y.yarnDensity ?? DEFAULT_YARN_DENSITY);
    kinds.push(packKind(y.structure, y.plies ?? 2));
  }
  const packed = packAxis(
    { centers, periodMm: period * pitch, diameters: diameter, kinds, limitL, limitR },
    resolvePacking(packing),
    spread,
  );
  const offset = new Float64Array(period);
  let minGap = Infinity;
  let maxHalfWidth = 0;
  for (let k = 0; k < period; k++) {
    offset[k] = packed.centers[k] - (k + 0.5) * pitch;
    const next = k + 1 < period ? packed.centers[k + 1] : packed.centers[0] + period * pitch;
    minGap = Math.min(minGap, next - packed.centers[k]);
    maxHalfWidth = Math.max(maxHalfWidth, packed.width[k] / 2);
  }
  return { offset, aspect: packed.aspect, diameter, pitch, minGap: Math.max(1e-4, minGap), maxHalfWidth, clearFraction: packed.clearFraction };
}
