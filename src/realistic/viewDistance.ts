/**
 * Bakış mesafesi (Durak 2-F; saf, testli). Zoom'dan ayrı üç görünüm:
 *  - 'eye'  (Göz, 40 cm) — Tezgah entegrasyonunda varsayılan;
 *  - 'far'  (Uzak, 2 m);
 *  - 'loupe'(Lup) — mevcut gerçekçi yakın görünüm, değişmez.
 *
 * Göz / Uzak: kumaş gerçek fiziksel ölçekte çizilir (ekranda 1 mm = gerçek 1 mm) ve gözün o mesafede ayırt
 * edemeyeceği detay önceden filtrelenir (renk karışımı doğrusal uzayda): iplik içi büküm / lif, iplik araları
 * komşu renklerle kaynaşır; örgü dokusu, dimi çizgisi ve bant / renk deseni korunur.
 */
import { pitchMm } from './scale';
import type { FabricInput } from './types';

export type ViewDistance = 'eye' | 'far' | 'loupe';

/** Bakış mesafeleri (mm). */
export const VIEW_DISTANCE_MM: Record<Exclude<ViewDistance, 'loupe'>, number> = { eye: 400, far: 2000 };

/** Gözün açısal çözünürlüğü: ~1 yay dakikası (normal görme keskinliği 20/20). */
export const ARCMIN_RAD = Math.PI / (180 * 60);

/** Mesafede ayırt edilebilen en küçük detay (mm): 40 cm → 0.116 mm, 2 m → 0.582 mm. */
export function resolvableMm(distanceMm: number): number {
  return distanceMm * Math.tan(ARCMIN_RAD);
}

/**
 * Ön filtre çekirdeği (Gauss σ, mm). VARSAYIM (görsel olarak seçildi, kalibre edilecek):
 *  - σ ≥ 2 · çözünürlük: 1′ keskinlik yüksek kontrastlı çizgi için sınırdır; düşük kontrastlı kumaş dokusunda
 *    kontrast duyarlılığı bunun yarı frekansında söner;
 *  - σ ≥ 0.35 · en büyük iplik aralığı: tek tek iplikler ve aralarındaki boşluklar bütün bir yüzeye kaynaşsın
 *    (aralık frekansında kontrast ≈ %9'a iner), dimi çizgisi (≥ 4 aralık periyot) ve bantlar korunur.
 */
export const BLUR_RES_MUL = 2;
export const BLUR_PITCH_MUL = 0.35;
export function viewBlurMm(distance: Exclude<ViewDistance, 'loupe'>, input: FabricInput): number {
  const pMax = Math.max(pitchMm(input.density.warpPerCm), pitchMm(input.density.weftPerCm));
  return Math.max(BLUR_RES_MUL * resolvableMm(VIEW_DISTANCE_MM[distance]), BLUR_PITCH_MUL * pMax);
}

/**
 * Fiziksel ölçek: CSS pikseli → mm. VARSAYIM: CSS 96 dpi (CSS spesifikasyonunun referans pikseli); gerçek ekranlar
 * farklıdır, ayarlardaki kart kalibrasyonu (`calibration` çarpanı) düzeltir.
 */
export const CSS_DPI = 96;
export const MM_PER_INCH = 25.4;
export function cssPxPerMm(calibration = 1): number {
  return (CSS_DPI / MM_PER_INCH) * calibration;
}

/** Kredi kartı genişliği (ISO/IEC 7810 ID-1): ekran kalibrasyonu için referans. */
export const CARD_WIDTH_MM = 85.6;

/**
 * Göz / Uzak modunda önbellek (döşeme) yoğunluğu: filtre çekirdeğini çözecek kadar (σ başına ≥ 4 texel),
 * en fazla 24 texel/mm — uzun raporların (LHOTSE ~40 cm) tamamı lup çözünürlüğünde pişirilmez.
 */
export const VIEW_BAKE_MAX_PER_MM = 24;
export function viewBakeDensity(blurMm: number): number {
  return Math.min(VIEW_BAKE_MAX_PER_MM, Math.max(4, 4 / blurMm));
}
