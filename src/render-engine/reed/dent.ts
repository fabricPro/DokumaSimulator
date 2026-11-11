/**
 * Bir dişteki (tarak dişi ya da atkı regülatörü dişi) ipliklerin merkezlerini yerleştirir — tarak ve regülatör
 * için ortak mantık (render-engine/reed/layout.ts ReedPositionGenerator, weft/regulator.ts).
 *
 *  - 'spread' (tarak): iplikler diş açıklığına n + 1 eşit boşlukla yayılır;
 *  - 'contact' (regülatör): iplikler temasla yan yana, diş merkezine ortalı (atkılar birbirine vurulur).
 * Toplam çap açıklığı aşarsa her iki kipte çaplar açıklığa ölçeklenir (sc < 1; iplikler sıkışır / üst üste biner) ve
 * `fits = false` döner.
 */
export type DentMode = 'spread' | 'contact';

export interface DentPlacement {
  /** Merkezler (mm), verilen sırayla. */
  centers: number[];
  /** Çapların toplamı (mm). */
  sumDiameter: number;
  /** Çap ölçeği (sığmıyorsa open / sumDiameter, aksi 1). */
  scale: number;
  fits: boolean;
}

export function placeInDent(center: number, open: number, diameters: ArrayLike<number>, mode: DentMode): DentPlacement {
  const n = diameters.length;
  let sumD = 0;
  for (let k = 0; k < n; k++) sumD += diameters[k];
  let x: number;
  let gap: number;
  let sc = 1;
  const fits = sumD <= open;
  if (fits) {
    if (mode === 'spread') {
      gap = (open - sumD) / (n + 1);
      x = center - open / 2 + gap;
    } else {
      gap = 0;
      x = center - sumD / 2;
    }
  } else {
    gap = 0;
    sc = open / sumD;
    x = center - open / 2;
  }
  const centers: number[] = [];
  for (let k = 0; k < n; k++) {
    const dg = diameters[k] * sc;
    centers.push(x + dg / 2);
    x += dg + gap;
  }
  return { centers, sumDiameter: sumD, scale: sc, fits };
}
