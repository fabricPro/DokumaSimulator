/**
 * Fiziksel simülasyonun rastgelelik kaynağı. İplik başına değerler global iplik indeksinden
 * hash'lenir (pencere kaydırılınca değişmez); lif gürültüsü (seed, σ) başına bir kez üretilen
 * döşenebilir dokudan, kumaşa sabitlenmiş piksel koordinatıyla okunur.
 */
import { gaussianBlur } from '../heightfield/gaussian';
import { hash3, mulberry32 } from '../random';

export interface PhysicalRandomSource {
  /** Çözgü g'nin wobble fazı, [0, 6.28). */
  warpPhase(g: number): number;
  weftPhase(g: number): number;
  /** Ton çarpanı 1 ± 0.05. */
  warpTone(g: number): number;
  weftTone(g: number): number;
  /**
   * σ (px) değerleriyle (eksen 0 = y, eksen 1 = x) gauss bulanık, std=1 lif gürültüsü örnekleyici.
   * (x, y) kumaşa sabit piksel koordinatlarıdır.
   */
  fiber(sigmaY: number, sigmaX: number): (x: number, y: number) => number;
}

const TILE = 256;
const MASK = TILE - 1;
const cache = new Map<string, Float32Array>();
const MAX_CACHE = 8;

function normalField(seed: number, n: number): Float32Array {
  const rnd = mulberry32(seed);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 2) {
    const u1 = Math.max(rnd(), 1e-12);
    const u2 = rnd();
    const m = Math.sqrt(-2 * Math.log(u1));
    out[i] = m * Math.cos(2 * Math.PI * u2);
    if (i + 1 < n) out[i + 1] = m * Math.sin(2 * Math.PI * u2);
  }
  return out;
}

function fiberTexture(seed: number, sy: number, sx: number): Float32Array {
  // σ'yı 0.05 px adımlarla yuvarla: zoom sırasında önbellek patlamasın
  const ky = Math.round(sy * 20) / 20;
  const kx = Math.round(sx * 20) / 20;
  const key = `${seed}|${ky}|${kx}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const t = gaussianBlur(normalField(seed * 7919 + 17, TILE * TILE), TILE, TILE, ky, kx, 'wrap');
  let m = 0;
  for (let i = 0; i < t.length; i++) m += t[i];
  m /= t.length;
  let v = 0;
  for (let i = 0; i < t.length; i++) v += (t[i] - m) ** 2;
  const std = Math.sqrt(v / t.length) + 1e-6;
  for (let i = 0; i < t.length; i++) t[i] /= std;
  if (cache.size >= MAX_CACHE) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(key, t);
  return t;
}

export function createPhysicalRandom(seed: number): PhysicalRandomSource {
  return {
    warpPhase: (g) => hash3(seed, 21, g) * 6.28,
    weftPhase: (g) => hash3(seed, 22, g) * 6.28,
    warpTone: (g) => 1 + (hash3(seed, 23, g) * 2 - 1) * 0.05,
    weftTone: (g) => 1 + (hash3(seed, 24, g) * 2 - 1) * 0.05,
    fiber: (sy, sx) => {
      const tex = fiberTexture(seed + (sy > sx ? 0 : 1), sy, sx);
      return (x, y) => tex[(y & MASK) * TILE + (x & MASK)];
    },
  };
}

/** Referans harness'ıyla aynı sabit değerler (uniform → aralık ortası, normal → 0). */
export function constantPhysicalRandom(): PhysicalRandomSource {
  return {
    warpPhase: () => 3.14,
    weftPhase: () => 3.14,
    warpTone: () => 1,
    weftTone: () => 1,
    fiber: () => () => 0,
  };
}
