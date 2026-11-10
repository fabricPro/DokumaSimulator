/**
 * Deterministik hash — GLSL'deki pcg3d ile bit düzeyinde aynı (gl/shaders/lit.glsl.ts NOISE_GLSL).
 * uint aritmetiği: Math.imul + >>> 0 (mod 2³²).
 */

export function pcg3d(x: number, y: number, z: number): [number, number, number] {
  x = (Math.imul(x >>> 0, 1664525) + 1013904223) >>> 0;
  y = (Math.imul(y >>> 0, 1664525) + 1013904223) >>> 0;
  z = (Math.imul(z >>> 0, 1664525) + 1013904223) >>> 0;
  x = (x + Math.imul(y, z)) >>> 0;
  y = (y + Math.imul(z, x)) >>> 0;
  z = (z + Math.imul(x, y)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  y = (y ^ (y >>> 16)) >>> 0;
  z = (z ^ (z >>> 16)) >>> 0;
  x = (x + Math.imul(y, z)) >>> 0;
  y = (y + Math.imul(z, x)) >>> 0;
  z = (z + Math.imul(x, y)) >>> 0;
  return [x, y, z];
}

/** GLSL hash01(ivec2 c, uint s): negatif tamsayılar 2²⁰ kaydırılır; [0, 1]. */
export function hash01(cx: number, cy: number, seed: number): number {
  const [h] = pcg3d((cx + (1 << 20)) >>> 0, (cy + (1 << 20)) >>> 0, seed >>> 0);
  return (h & 0xffffff) / 16777215;
}

/** İplik başına rastgele değer [−1, 1]: eksen (0 çözgü, 1 atkı), global indeks, kanal. GLSL: threadRand. */
export function threadRand(axis: 0 | 1, index: number, channel: number, seed: number): number {
  return hash01(index, axis * 16 + channel, seed) * 2 - 1;
}

/** Kanallar. */
export const CH_THICKNESS = 0;
export const CH_POSITION = 1;
export const CH_COLOR_L = 2;
export const CH_COLOR_A = 3;
export const CH_COLOR_B = 4;
