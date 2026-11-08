/**
 * Bağlantı istatistikleri ve Ashenhurst teorik maksimum sıklığı.
 *
 * İki farklı "I" vardır, karıştırılmamalı:
 *  - Ashenhurst (yanal sığma): çözgü sıklığı için I = bir atkı boyunca atkının çözgülerin arasından
 *    geçiş sayısı = Σ_k w_k (komşu çözgülerin farklı durumda olduğu yerler), E = rapordaki çözgü sayısı.
 *    reference/weave_phys.py bunu eksenleri ters sayarak hesaplıyordu; burada düzeltildi, bu yüzden
 *    sıkışma oranı referanstan bilinçli olarak farklıdır.
 *  - Peirce kıvrımı: I = iplik boyunca bağlantı değişimi sayısı, E = iplik boyunca rapor uzunluğu
 *    (alongYarnInterlacing). Referanstaki tanım bu kullanım için doğrudur.
 */
import { sum, warpGapBinding, weftGapBinding } from './interlacing';

/** "Sıkıştı" eşiği: komşu aralığı (r_k + r_k+1)·MIN_SQUEEZE'den küçükse. */
export const MIN_SQUEEZE = 0.55;

export interface InterlacingStats {
  E: number;
  I: number;
}

/**
 * İplik boyunca bağlantı (kıvrım için): axis 'warp' → her çözgü boyunca (E = rapordaki atkı sayısı),
 * 'weft' → her atkı boyunca (E = rapordaki çözgü sayısı). I = döngüsel durum değişimi ortalaması.
 */
export function alongYarnInterlacing(M: boolean[][], axis: 'warp' | 'weft'): InterlacingStats {
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

/**
 * Ashenhurst için yanal bağlantı: çözgü sıklığı → E = rapordaki çözgü sayısı, I = Σ w_k (çözgü aralıkları).
 * Atkı sıklığı → E = rapordaki atkı sayısı, I = Σ w_k (atkı aralıkları).
 */
export function lateralInterlacing(M: boolean[][], axis: 'warp' | 'weft'): InterlacingStats {
  return axis === 'warp'
    ? { E: M[0].length, I: sum(warpGapBinding(M)) }
    : { E: M.length, I: sum(weftGapBinding(M)) };
}

/** Ashenhurst teorik maksimum sıklık (tel/cm): (10/d)·E/(E+I). Üst sınırdır, kesin dokunabilirlik sınırı değil. */
export function ashenhurstMax(M: boolean[][], axis: 'warp' | 'weft', dMm: number): InterlacingStats & { max: number } {
  const st = lateralInterlacing(M, axis);
  return { ...st, max: (10 / dMm) * (st.E / (st.E + st.I)) };
}
