/**
 * Komşu iplik çiftlerinin bağlantı oranı (saf fonksiyonlar).
 *
 * Dayanak:
 *  - Ashenhurst: atkı, durumu farklı iki komşu çözgünün arasından geçer ve aralarında bir çap
 *    kadar yer kaplar; maksimum sıklık E·(10/d)/(E+I).
 *  - Yalancı lino (US10023981B2; Grosicki, Watson's Textile Design and Colour; Hayavadana,
 *    Woven Fabric Structure Design, "Mock leno and distorted effects"): grup içindeki iplikler
 *    aynı hareketi yaptıkları için kolayca bir araya gelir; bir grubun son ipliği ile sonraki
 *    grubun ilk ipliği ters bağlandığı için birleşemez ve açıklık oluşur.
 *
 * w_k ∈ [0,1]: k ve k+1 ipliklerinin farklı durumda olduğu karşı ipliklerin oranı.
 * w = 0 → aralarından hiç karşı iplik geçmez (toplanabilir); w = 1 → her karşı iplik geçer.
 * Rapor boyunca Σ w_k = Ashenhurst I.
 */

/** Matris erişimi: M[satır = atkı][sütun = çözgü], rapor modunda. */
function at(M: boolean[][], row: number, col: number): boolean {
  const Rr = M.length;
  const Rc = M[0].length;
  return M[((row % Rr) + Rr) % Rr][((col % Rc) + Rc) % Rc];
}

/** Çözgü aralıkları: k = 0..Rc−1, aralık k ile k+1 (döngüsel) arası. */
export function warpGapBinding(M: boolean[][]): Float64Array {
  const Rr = M.length;
  const Rc = M[0].length;
  const w = new Float64Array(Rc);
  for (let k = 0; k < Rc; k++) {
    let n = 0;
    for (let j = 0; j < Rr; j++) if (at(M, j, k) !== at(M, j, k + 1)) n++;
    w[k] = n / Rr;
  }
  return w;
}

/** Atkı aralıkları: k = 0..Rr−1, aralık k ile k+1 (döngüsel) arası. */
export function weftGapBinding(M: boolean[][]): Float64Array {
  const Rr = M.length;
  const Rc = M[0].length;
  const w = new Float64Array(Rr);
  for (let k = 0; k < Rr; k++) {
    let n = 0;
    for (let i = 0; i < Rc; i++) if (at(M, k, i) !== at(M, k + 1, i)) n++;
    w[k] = n / Rc;
  }
  return w;
}

/**
 * Çözgü (axis 'warp') veya atkı ('weft') eksenindeki global k aralığı için karşı iplik çapıyla
 * ağırlıklı bağlantı terimi: t_k = (1/n)·Σ_j [farklı]·d_karşı(j). Karşı iplik dizisinin periyodu
 * boyunca ortalanır (crossDiameterAt(j), j = 0..crossPeriod−1).
 */
export function crossWeightedGap(
  M: boolean[][],
  axis: 'warp' | 'weft',
  k: number,
  crossDiameterAt: (j: number) => number,
  crossPeriod: number,
): number {
  let s = 0;
  for (let j = 0; j < crossPeriod; j++) {
    const differ = axis === 'warp' ? at(M, j, k) !== at(M, j, k + 1) : at(M, k, j) !== at(M, k + 1, j);
    if (differ) s += crossDiameterAt(j);
  }
  return s / crossPeriod;
}

/** Örgünün transpozu: çözgü ↔ atkı (Mᵀ[i][j] = M[j][i]). warpGapBinding(Mᵀ) = weftGapBinding(M). */
export function transposeWeave(M: boolean[][]): boolean[][] {
  const rows = M.length;
  const cols = M[0].length;
  const out: boolean[][] = [];
  for (let i = 0; i < cols; i++) {
    const r: boolean[] = [];
    for (let j = 0; j < rows; j++) r.push(M[j][i]);
    out.push(r);
  }
  return out;
}

export function sum(a: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return s;
}
