import { gaussianBlur } from './gaussian';
import { hash3, mulberry32 } from '../random';
import type { RandomSource } from '../types';

/** Lif gürültü dokusu kenarı (2'nin kuvveti; döşenebilir). */
export const NOISE_TILE = 512;

interface NoiseTextures {
  warp: Float32Array;
  weft: Float32Array;
}

const textureCache = new Map<number, NoiseTextures>();
const MAX_CACHED_SEEDS = 4;

/** Standart normal gürültü (Box–Muller), deterministik. */
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

function normalizeStd(a: Float32Array): Float32Array {
  let mean = 0;
  for (let i = 0; i < a.length; i++) mean += a[i];
  mean /= a.length;
  let v = 0;
  for (let i = 0; i < a.length; i++) v += (a[i] - mean) ** 2;
  const std = Math.sqrt(v / a.length) + 1e-6;
  for (let i = 0; i < a.length; i++) a[i] /= std;
  return a;
}

/**
 * Seed'e göre önbellekli, döşenebilir lif gürültü dokuları.
 * Çözgü: boyuna (y) σ=5, enine σ=1.3. Atkı: tersi. (referans: fiber_noise)
 */
export function noiseTextures(seed: number): NoiseTextures {
  const hit = textureCache.get(seed);
  if (hit) return hit;
  const S = NOISE_TILE;
  const warp = normalizeStd(gaussianBlur(normalField(seed * 2 + 1, S * S), S, S, 5, 1.3, 'wrap'));
  const weft = normalizeStd(gaussianBlur(normalField(seed * 2 + 2, S * S), S, S, 1.3, 5, 'wrap'));
  const tex = { warp, weft };
  if (textureCache.size >= MAX_CACHED_SEEDS) {
    const first = textureCache.keys().next().value;
    if (first !== undefined) textureCache.delete(first);
  }
  textureCache.set(seed, tex);
  return tex;
}

/** Varsayılan rastgelelik kaynağı: iplik başına hash, piksel başına döşenen gürültü dokusu. */
export function createRandomSource(seed: number): RandomSource {
  const tex = noiseTextures(seed);
  const mask = NOISE_TILE - 1;
  const TWO_PI = Math.PI * 2;
  return {
    warpPhase: (i) => hash3(seed, 11, i) * TWO_PI,
    weftPhase: (j) => hash3(seed, 12, j) * TWO_PI,
    warpTone: (i) => 1 + (hash3(seed, 13, i) * 2 - 1) * 0.06,
    weftTone: (j) => 1 + (hash3(seed, 14, j) * 2 - 1) * 0.06,
    warpFiber: (x, y) => tex.warp[(y & mask) * NOISE_TILE + (x & mask)],
    weftFiber: (x, y) => tex.weft[(y & mask) * NOISE_TILE + (x & mask)],
  };
}

/** Gürültüsüz kaynak: referansla piksel karşılaştırması ve testler için. */
export function constantRandomSource(phase = Math.PI, tone = 1): RandomSource {
  return {
    warpPhase: () => phase,
    weftPhase: () => phase,
    warpTone: () => tone,
    weftTone: () => tone,
    warpFiber: () => 0,
    weftFiber: () => 0,
  };
}
