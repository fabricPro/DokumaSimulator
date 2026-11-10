/**
 * fix-v2: önceden üretilen, tekrar eden anizotropik lif gürültüsü dokusu (saf, deterministik).
 * Prototip (prototip_render_v2.py) her karede gaussian_filter(normal, σ = (4, 0.4)) kullanır: iplik
 * ekseni boyunca 10× uzamış lifler. Burada bir kez 256² üretilip GPU'ya yüklenir; shader iplik
 * çerçevesinde (enine, boyunca) örnekler, her karede hesap yoktur.
 *
 * Doku düzeni: x = enine, y = boyunca (iplik ekseni). Birim: FIBER_TEXELS_PER_D texel = 1 iplik çapı.
 * Prototipte σ piksel cinsindendir: yakın planda (çap ≈ 27 px) boyunca 2 px ≈ 0.075·d, enine 0.2 px ≈ 0.0075·d.
 * VARSAYIM (kalibre edilecek): σ_boyunca = 2.4 texel = 0.075·d, σ_enine = 0.3 texel ≈ 0.01·d
 * (texel altı: enine pratikte beyaz gürültü, ince lif çizgileri).
 */

export const FIBER_TEX_SIZE = 256;
export const FIBER_TEXELS_PER_D = 32;
export const FIBER_SIGMA_ALONG = 2.4;
export const FIBER_SIGMA_ACROSS = 0.3;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussKernel(sigma: number): Float64Array {
  if (sigma <= 0) return Float64Array.of(1);
  const r = Math.max(1, Math.ceil(3 * sigma));
  const k = new Float64Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) sum += k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return k;
}

/** Ayrık gauss, sarmalı (wrap) kenar: doku kesintisiz tekrar eder. */
function blurWrap(src: Float64Array, n: number, sigmaX: number, sigmaY: number): Float64Array {
  const kx = gaussKernel(sigmaX);
  const ky = gaussKernel(sigmaY);
  const rx = (kx.length - 1) / 2;
  const ry = (ky.length - 1) / 2;
  const tmp = new Float64Array(n * n);
  const out = new Float64Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let s = 0;
      for (let k = -rx; k <= rx; k++) s += kx[k + rx] * src[y * n + ((x + k + n) % n)];
      tmp[y * n + x] = s;
    }
  }
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let s = 0;
      for (let k = -ry; k <= ry; k++) s += ky[k + ry] * tmp[((y + k + n) % n) * n + x];
      out[y * n + x] = s;
    }
  }
  return out;
}

/** n×n, ortalama 0, std 1 anizotropik gauss gürültüsü. Aynı tohum → birebir aynı doku. */
export function bakeFiberNoise(
  n = FIBER_TEX_SIZE,
  sigmaAlong = FIBER_SIGMA_ALONG,
  sigmaAcross = FIBER_SIGMA_ACROSS,
  seed = 1,
): Float32Array {
  const rnd = mulberry32(seed * 7919 + 17);
  const white = new Float64Array(n * n);
  for (let i = 0; i < white.length; i += 2) {
    const u1 = Math.max(rnd(), 1e-12);
    const u2 = rnd();
    const m = Math.sqrt(-2 * Math.log(u1));
    white[i] = m * Math.cos(2 * Math.PI * u2);
    if (i + 1 < white.length) white[i + 1] = m * Math.sin(2 * Math.PI * u2);
  }
  const b = blurWrap(white, n, sigmaAcross, sigmaAlong);
  let mean = 0;
  for (const v of b) mean += v;
  mean /= b.length;
  let varSum = 0;
  for (const v of b) varSum += (v - mean) ** 2;
  const std = Math.sqrt(varSum / b.length) + 1e-12;
  const out = new Float32Array(n * n);
  for (let i = 0; i < b.length; i++) out[i] = (b[i] - mean) / std;
  return out;
}
