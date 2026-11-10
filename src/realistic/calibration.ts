/**
 * Kalibrasyon yardımcıları (saf, testli): fotoğraf ölçeği ve fotoğraf ↔ simülasyon ortak görünümü.
 *
 * Görünüm koordinatları: ekranda sol üst köşe fotoğrafta (x0Cm, y0Cm) noktasıdır; y aşağı artar
 * (fotoğraf düzeni). Kumaşta y yukarı artar (atkı 0 alttadır), bu yüzden simülasyonun
 * `offsetCm` (canvas'ın sol alt köşesi) değeri y'de işaret değiştirir.
 */
import type { ViewParams } from './types';

export interface Point {
  x: number;
  y: number;
}

/** Fotoğrafta işaretlenen iki nokta + aralarındaki gerçek uzaklık (cm) → px/cm. */
export function scaleFromPoints(a: Point, b: Point, distanceCm: number): number {
  if (!(distanceCm > 0)) throw new Error('Uzaklık 0\'dan büyük olmalı.');
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  if (d < 2) throw new Error('İki nokta çok yakın; en az birkaç piksel ayrı işaretleyin.');
  return d / distanceCm;
}

export interface CalibView {
  /** Ekran ölçeği: CSS px / cm (fotoğraf ve simülasyon aynı). */
  screenPxPerCm: number;
  /** Ekran sol üst köşesinin fotoğraftaki konumu (cm, y aşağı). */
  x0Cm: number;
  y0Cm: number;
  /** Simülasyonun fotoğrafa göre ek kayması (cm, y aşağı): faz hizalaması için. */
  simShiftCm: [number, number];
}

/** Fotoğraf <img> yerleşimi (CSS px): sol, üst, genişlik, yükseklik. */
export function photoRect(v: CalibView, photo: { width: number; height: number; pxPerCm: number }) {
  const s = v.screenPxPerCm / photo.pxPerCm;
  return { left: -v.x0Cm * v.screenPxPerCm, top: -v.y0Cm * v.screenPxPerCm, width: photo.width * s, height: photo.height * s };
}

/**
 * Simülasyon görünüm parametreleri. Canvas cihaz pikseli = CSS px × dpr; ölçek de dpr ile çarpılır,
 * böylece 1 cm ekranda fotoğraftaki 1 cm ile aynı uzunlukta görünür.
 */
export function simView(
  v: CalibView,
  cssHeight: number,
  dpr: number,
  base: Omit<ViewParams, 'pxPerCm' | 'offsetCm'>,
): ViewParams {
  const x = v.x0Cm - v.simShiftCm[0];
  const yTop = v.y0Cm - v.simShiftCm[1];
  const yBottom = yTop + cssHeight / v.screenPxPerCm;
  return { ...base, pxPerCm: v.screenPxPerCm * dpr, offsetCm: [x, -yBottom] };
}

/** İmleç etrafında yakınlaştırma: imlecin altındaki fotoğraf noktası yerinde kalır. */
export function zoomAt(v: CalibView, cursor: Point, factor: number, min: number, max: number): CalibView {
  const s = Math.min(max, Math.max(min, v.screenPxPerCm * factor));
  const cx = v.x0Cm + cursor.x / v.screenPxPerCm;
  const cy = v.y0Cm + cursor.y / v.screenPxPerCm;
  return { ...v, screenPxPerCm: s, x0Cm: cx - cursor.x / s, y0Cm: cy - cursor.y / s };
}
