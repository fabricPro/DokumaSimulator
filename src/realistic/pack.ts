/**
 * FabricInput → GPU doku verileri (saf, testli).
 *
 *  - weave: R8UI, genişlik = rapordaki çözgü, yükseklik = rapordaki atkı; satır 0 = atkı 0 (alt).
 *    WebGL'de doku satır 0 v = 0'dadır, kumaşta da y = 0 alttır; ters çevirme yok.
 *  - warpColors / weftColors: RGBA8, n × 1 (sRGB renk, alfa 255).
 *  - warpTypes / weftTypes: R8UI, n × 1 (yarnTypes indeksi).
 *  - yarnTypes: RGBA32F, m × 1: (çap mm, büküm tur/mm işaretli: S = −, Z = +, parlaklık 0/1/2, tüylülük).
 */
import { DEFAULT_YARN_DENSITY, diameterMm, toTex } from './yarn';
import type { FabricInput, Luster } from './types';

export const DEFAULT_TWIST_PER_M = 500;
const LUSTER_INDEX: Record<Luster, number> = { mat: 0, yarimat: 1, parlak: 2 };

export interface PackedFabric {
  weave: { width: number; height: number; data: Uint8Array };
  warpColors: Uint8Array;
  weftColors: Uint8Array;
  warpTypes: Uint8Array;
  weftTypes: Uint8Array;
  yarnTypes: Float32Array;
  counts: { warp: number; weft: number; yarnTypes: number };
}

export function hexToRgba(hex: string): [number, number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Geçersiz renk: ${hex} (#rrggbb bekleniyor)`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

export function validateInput(input: FabricInput): void {
  const { warps, wefts, data } = input.weave;
  if (!(Number.isInteger(warps) && warps > 0 && Number.isInteger(wefts) && wefts > 0)) {
    throw new Error('Örgü boyutu pozitif tamsayı olmalı.');
  }
  if (data.length !== warps * wefts) throw new Error(`Örgü verisi ${warps}×${wefts} = ${warps * wefts} olmalı, ${data.length} geldi.`);
  for (let k = 0; k < data.length; k++) if (data[k] > 1) throw new Error(`Örgü değeri 0/1 olmalı (indeks ${k}).`);
  if (input.warp.length === 0 || input.weft.length === 0) throw new Error('Çözgü ve atkı dizileri boş olamaz.');
  if (input.yarnTypes.length === 0 || input.yarnTypes.length > 255) throw new Error('İplik tipi sayısı 1–255 olmalı.');
  for (const [name, list] of [
    ['çözgü', input.warp],
    ['atkı', input.weft],
  ] as const) {
    list.forEach((t, i) => {
      if (!(Number.isInteger(t.yarnType) && t.yarnType >= 0 && t.yarnType < input.yarnTypes.length)) {
        throw new Error(`${name} ${i}: geçersiz iplik tipi ${t.yarnType}.`);
      }
    });
  }
  if (!(input.density.warpPerCm > 0 && input.density.weftPerCm > 0)) throw new Error('Sıklıklar pozitif olmalı.');
}

export function packFabric(input: FabricInput): PackedFabric {
  validateInput(input);
  const colors = (list: FabricInput['warp']) => {
    const out = new Uint8Array(list.length * 4);
    list.forEach((t, i) => out.set(hexToRgba(t.color), i * 4));
    return out;
  };
  const types = (list: FabricInput['warp']) => Uint8Array.from(list, (t) => t.yarnType);
  const yt = new Float32Array(input.yarnTypes.length * 4);
  input.yarnTypes.forEach((y, i) => {
    const d = diameterMm(toTex(y.count, y.unit), y.yarnDensity ?? DEFAULT_YARN_DENSITY);
    const tpmm = (y.twistPerM ?? DEFAULT_TWIST_PER_M) / 1000;
    yt[i * 4] = d;
    yt[i * 4 + 1] = y.twist === 'S' ? -tpmm : tpmm;
    yt[i * 4 + 2] = LUSTER_INDEX[y.luster];
    yt[i * 4 + 3] = Math.max(0, Math.min(1, y.hairiness));
  });
  return {
    weave: { width: input.weave.warps, height: input.weave.wefts, data: input.weave.data },
    warpColors: colors(input.warp),
    weftColors: colors(input.weft),
    warpTypes: types(input.warp),
    weftTypes: types(input.weft),
    yarnTypes: yt,
    counts: { warp: input.warp.length, weft: input.weft.length, yarnTypes: input.yarnTypes.length },
  };
}
