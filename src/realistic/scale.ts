/**
 * Ölçek ve piksel → kumaş eşlemesi (saf; shader'daki hesapların CPU ikizi).
 *
 * Kumaş koordinatı mm, y yukarı. İplik i, [i·p, (i+1)·p) aralığını kaplar; merkezi (i + 0.5)·p.
 * Canvas pikseli (px, py) (py alttan, GL düzeni) → x = ofset + px / (px/mm), y = ofset + py / (px/mm).
 * Shader float32 ile hesapladığı için ikiz Math.fround kullanır.
 */
import type { FabricInput, ViewParams } from './types';

/** İplik aralığı (mm) = 10 / sıklık (tel/cm). */
export function pitchMm(perCm: number): number {
  if (!(perCm > 0)) throw new Error(`Geçersiz sıklık: ${perCm}`);
  return 10 / perCm;
}

/** İplik aralığı (px) = aralık (mm) × px/mm. */
export function pitchPx(perCm: number, pxPerCm: number): number {
  return pitchMm(perCm) * (pxPerCm / 10);
}

export function pmod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** Canvas pikselinin (GL düzeni, alttan) kumaştaki mm konumu. */
export function pixelToMm(px: number, py: number, view: ViewParams): [number, number] {
  const ppm = Math.fround(view.pxPerCm / 10);
  return [
    Math.fround(Math.fround(view.offsetCm[0] * 10) + Math.fround(px / ppm)),
    Math.fround(Math.fround(view.offsetCm[1] * 10) + Math.fround(py / ppm)),
  ];
}

export interface CellHit {
  /** Global çözgü ve atkı indeksleri. */
  warp: number;
  weft: number;
  /** Çözgü üstte mi. */
  warpUp: boolean;
}

/** mm konumunun düştüğü hücre (Faz 1: eşit aralık). */
export function cellAt(xMm: number, yMm: number, input: FabricInput): CellHit {
  const pw = Math.fround(pitchMm(input.density.warpPerCm));
  const pf = Math.fround(pitchMm(input.density.weftPerCm));
  const warp = Math.floor(Math.fround(xMm / pw));
  const weft = Math.floor(Math.fround(yMm / pf));
  const { warps, wefts, data } = input.weave;
  const up = data[pmod(weft, wefts) * warps + pmod(warp, warps)] === 1;
  return { warp, weft, warpUp: up };
}

/** Faz 1 düz renk ikizi: pikselde görünen ipliğin rengi. */
export function flatColorAt(px: number, py: number, input: FabricInput, view: ViewParams): string {
  const [x, y] = pixelToMm(px, py, view);
  const c = cellAt(x, y, input);
  return c.warpUp ? input.warp[pmod(c.warp, input.warp.length)].color : input.weft[pmod(c.weft, input.weft.length)].color;
}
