/**
 * Sıkışma ve Ashenhurst teorik maksimum sıklığı. Karşılık: reference/weave_phys.py §3.
 */

export const MIN_SQUEEZE = 0.55;

export interface SqueezeResult {
  /** Genişlik ölçeği s (≤ 1, alt sınır MIN_SQUEEZE). */
  width: Float64Array;
  /** Yükseklik ölçeği s^−0.5 (yanal sıkışan iplik yükselir). */
  height: Float64Array;
  /** s alt sınırın altına inen ("sıkıştı") iplikler. */
  jammed: Uint8Array;
  anyJammed: boolean;
}

/** Komşu merkez mesafesi < r_k + r_k+1 ise iki ipliği orantılı daralt. */
export function squeeze(centers: ArrayLike<number>, radii: ArrayLike<number>, minScale = MIN_SQUEEZE): SqueezeResult {
  const n = centers.length;
  const s = new Float64Array(n).fill(1);
  for (let k = 0; k < n - 1; k++) {
    const gap = centers[k + 1] - centers[k];
    const need = radii[k] + radii[k + 1];
    if (need > gap) {
      const f = gap / need;
      s[k] = Math.min(s[k], f);
      s[k + 1] = Math.min(s[k + 1], f);
    }
  }
  const jammed = new Uint8Array(n);
  const height = new Float64Array(n);
  let anyJammed = false;
  for (let k = 0; k < n; k++) {
    if (s[k] < minScale) {
      jammed[k] = 1;
      anyJammed = true;
    }
    s[k] = Math.max(s[k], minScale);
    height[k] = s[k] ** -0.5;
  }
  return { width: s, height, jammed, anyJammed };
}

export interface InterlacingStats {
  /** Rapordaki iplik sayısı (iplik boyunca rapor uzunluğu). */
  E: number;
  /** Rapor boyunca ortalama bağlantı değişimi sayısı (döngüsel). */
  I: number;
}

/**
 * axis 'warp' → her çözgü (sütun) boyunca satırlar; 'weft' → her atkı (satır) boyunca sütunlar.
 * Referanstaki gibi E = iplik boyunca rapor uzunluğu, I = np.roll ile döngüsel değişim ortalaması.
 */
export function interlacing(M: boolean[][], axis: 'warp' | 'weft'): InterlacingStats {
  const rows = M.length;
  const cols = M[0].length;
  const lines = axis === 'warp' ? cols : rows;
  const E = axis === 'warp' ? rows : cols;
  let total = 0;
  for (let l = 0; l < lines; l++) {
    const at = (k: number) => (axis === 'warp' ? M[k][l] : M[l][k]);
    for (let k = 0; k < E; k++) if (at(k) !== at((k - 1 + E) % E)) total++;
  }
  return { E, I: total / lines };
}

/** Ashenhurst teorik maksimum sıklık (tel/cm): 10/d · E/(E+I). */
export function ashenhurstMax(M: boolean[][], axis: 'warp' | 'weft', dMm: number): InterlacingStats & { max: number } {
  const st = interlacing(M, axis);
  return { ...st, max: (10 / dMm) * (st.E / (st.E + st.I)) };
}
