/**
 * scipy.ndimage.gaussian_filter ile uyumlu ayrılabilir Gauss bulanıklığı.
 * truncate = 4.0, yarıçap = int(4σ + 0.5); kenar modu 'reflect' (d c b a | a b c d | d c b a)
 * veya 'wrap' (döşenebilir dokular için).
 */

export type EdgeMode = 'reflect' | 'wrap';

export function gaussianKernel(sigma: number, truncate = 4.0): Float32Array {
  const radius = Math.trunc(truncate * sigma + 0.5);
  const k = new Float32Array(2 * radius + 1);
  if (sigma <= 0) {
    k[radius] = 1;
    return k;
  }
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp((-0.5 * i * i) / (sigma * sigma));
    k[i + radius] = v;
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return k;
}

function edgeIndex(i: number, n: number, mode: EdgeMode): number {
  if (mode === 'wrap') return ((i % n) + n) % n;
  // reflect (yarım örnek simetrik), periyot 2n
  const p = 2 * n;
  let m = ((i % p) + p) % p;
  if (m >= n) m = p - 1 - m;
  return m;
}

/** 1D konvolüsyon, satır (axis=1, x) veya sütun (axis=0, y) boyunca. */
function convolve1d(
  src: Float32Array,
  dst: Float32Array,
  width: number,
  height: number,
  kernel: Float32Array,
  axis: 0 | 1,
  mode: EdgeMode,
): void {
  const r = (kernel.length - 1) >> 1;
  const n = axis === 1 ? width : height;
  // Kenar indeks tablosu (−r .. n+r)
  const idx = new Int32Array(n + 2 * r);
  for (let i = 0; i < idx.length; i++) idx[i] = edgeIndex(i - r, n, mode);
  if (axis === 1) {
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        let acc = 0;
        for (let k = 0; k < kernel.length; k++) acc += kernel[k] * src[row + idx[x + k]];
        dst[row + x] = acc;
      }
    }
  } else {
    for (let y = 0; y < height; y++) {
      const out = y * width;
      for (let k = 0; k < kernel.length; k++) {
        const w = kernel[k];
        const srow = idx[y + k] * width;
        for (let x = 0; x < width; x++) dst[out + x] += w * src[srow + x];
      }
    }
  }
}

/**
 * 2D Gauss bulanıklığı. sigmaY = eksen 0 (satırlar/y), sigmaX = eksen 1 (x) — scipy sırasıyla.
 * Sonuç yeni bir tampon olarak döner; `src` değişmez.
 */
export function gaussianBlur(
  src: Float32Array,
  width: number,
  height: number,
  sigmaY: number,
  sigmaX: number = sigmaY,
  mode: EdgeMode = 'reflect',
): Float32Array {
  // scipy önce eksen 0, sonra eksen 1 uygular.
  const tmp = new Float32Array(src.length);
  convolve1d(src, tmp, width, height, gaussianKernel(sigmaY), 0, mode);
  const out = new Float32Array(src.length);
  convolve1d(tmp, out, width, height, gaussianKernel(sigmaX), 1, mode);
  return out;
}
