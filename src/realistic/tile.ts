/**
 * fix-v2 adım 2: önbellek döşemesi (saf, testli).
 *
 * Gölge, AO ve tüylülük her karede hesaplanmaz: desen / iplik / ışık / ayar değişince kumaş uzayında bir
 * DÖŞEME (tile) için bir kez pişirilir; gezinme (pan / zoom) yalnız bu dokudan `mm mod döşeme` ile okur.
 *
 * Döşemenin kesintisiz tekrar etmesi için geometrinin döşemeyle periyodik olması gerekir:
 *  - döşeme = lcm(örgü raporu, renk / iplik dizisi) iplik; en az MIN_TILE_MM olacak şekilde katlanır;
 *  - iplik başına rastgele değerler (kalınlık, konum, renk sapması, faz) indeks mod döşeme ile;
 *  - iplik boyunca frekanslar (kat aralığı, ince lif, kalınlık / yol dalgalanması, lif dokusu) döşeme
 *    uzunluğuna tam sayı periyot sığacak şekilde yuvarlanır (değişim küçük: döşeme ≥ 12 mm).
 * VARSAYIM: düzensizlik döşeme boyunda (≥ 12 mm) tekrar eder; yakın planda fark edilmez.
 */
import { pitchMm } from './scale';
import type { FabricInput } from './types';

export const MIN_TILE_MM = 12;
/** Renk dizisi dahil döşeme bundan uzunsa yalnız örgü raporu kullanılır (tüy kökü rengi yaklaşık olur). */
export const MAX_TILE_THREADS = 2048;

export function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}
export function lcm(a: number, b: number): number {
  return (a / gcd(a, b)) * b;
}

export interface TileInfo {
  /** Döşemedeki iplik sayısı (çözgü, atkı). */
  threads: [number, number];
  /** Döşeme boyu (mm). */
  mm: [number, number];
  /** Renk / iplik dizisi döşemeye tam sığıyor mu (tüy kök rengi birebir). */
  colorExact: boolean;
}

export function tileFor(input: FabricInput, minTileMm = MIN_TILE_MM, maxThreads = MAX_TILE_THREADS): TileInfo {
  const pw = pitchMm(input.density.warpPerCm);
  const pf = pitchMm(input.density.weftPerCm);
  let bx = lcm(input.weave.warps, input.warp.length);
  let by = lcm(input.weave.wefts, input.weft.length);
  let colorExact = true;
  if (bx > maxThreads || by > maxThreads) {
    colorExact = false;
    bx = input.weave.warps;
    by = input.weave.wefts;
  }
  const kx = Math.max(1, Math.ceil(minTileMm / (bx * pw)));
  const ky = Math.max(1, Math.ceil(minTileMm / (by * pf)));
  const tx = bx * kx;
  const ty = by * ky;
  return { threads: [tx, ty], mm: [tx * pw, ty * pf], colorExact };
}

/**
 * Pişirme yoğunluğu (texel / mm): hedef `perPitch` texel / en küçük iplik aralığı; en uzun kenar
 * `maxSide`'ı aşmaz. Masaüstü 64 / mm'ye kadar (128 px/mm yakın planda gölge kenarı ≈ 2 px).
 */
export function bakeDensity(tile: TileInfo, input: FabricInput, maxSide: number, perPitch = 16, cap = 64): number {
  const pMin = Math.min(pitchMm(input.density.warpPerCm), pitchMm(input.density.weftPerCm));
  const want = Math.min(cap, perPitch / pMin);
  return Math.max(1, Math.min(want, maxSide / Math.max(tile.mm[0], tile.mm[1])));
}

/** Periyodu, L uzunluğuna tam sayı kez sığacak en yakın değere yuvarlar. */
export function snapPeriod(period: number, L: number): number {
  if (!(period > 0) || !Number.isFinite(period)) return period;
  return L / Math.max(1, Math.round(L / period));
}

/** Açısal frekansı (sin(f·s)) L boyunca tam periyoda yuvarlar. */
export function snapFreq(f: number, L: number): number {
  const n = Math.max(1, Math.round((f * L) / (2 * Math.PI)));
  return (2 * Math.PI * n) / L;
}
