/**
 * Bakış mesafesi (saf, testli). Bakış modu bir ÖLÇEK değil, kumaş uzayında bir algısal FİLTREDİR:
 *  - 'eye'  (Göz, 40 cm) — Tezgah entegrasyonunda varsayılan;
 *  - 'far'  (Uzak, 2 m);
 *  - 'loupe'(Lup) — filtre yok (gerçekçi yakın görünüm).
 *
 * Filtre çekirdeği kumaşa bağlıdır (mm); zoom serbesttir ve filtre zoom'la birlikte ölçeklenir: yakınlaştırınca
 * "bu mesafeden gözün gördüğü kumaşın büyütülmüş hali" görünür (örgü dokusu, dimi çizgisi, iplik yönü seçilir;
 * iplik içi büküm / lif detayı görünmez). "Gerçek boyut" ayrı bir zoom ön ayarıdır (cssPxPerMm + ekran kalibrasyonu).
 *
 * Otomatik LOD: hangi modda olursa olsun piksel ayak izi bundan büyükse ayak izine eşit minimum filtre uygulanır
 * (pişirilmiş döşemenin mip seviyesi). Renk karışımı doğrusal uzaydadır.
 */
import type { FabricInput } from './types';
import { pitchMm } from './scale';
import { DEFAULT_YARN_DENSITY, diameterMm, toTex } from './yarn';

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
 * Algısal filtrenin ÇAPI (Gauss tam genişlik yarı yükseklik, FWHM; mm, kumaş üzerinde). VARSAYIM: çap = 1′ çözünürlük
 * (gözün iki noktayı ayırabildiği en küçük açı); Göz 0.116 mm, Uzak 0.582 mm, Lup 0 (filtre yok).
 */
export function filterFwhmMm(distance: ViewDistance): number {
  return distance === 'loupe' ? 0 : resolvableMm(VIEW_DISTANCE_MM[distance]);
}

/** Gauss σ = FWHM / (2·√(2·ln 2)) ≈ FWHM / 2.355. */
export const FWHM_PER_SIGMA = 2 * Math.sqrt(2 * Math.LN2);
export function sigmaFromFwhm(fwhmMm: number): number {
  return fwhmMm / FWHM_PER_SIGMA;
}

/** Piksel ayak izi (mm): ekranda bir cihaz pikselinin kumaşta kapladığı boy. */
export function footprintMm(pxPerMm: number): number {
  return 1 / pxPerMm;
}

/** Etkin filtre çapı: mod çapı ile ayak izinin büyüğü (otomatik LOD; ızgara / moiré olmaz). */
export function effectiveFwhmMm(distance: ViewDistance, pxPerMm: number): number {
  return Math.max(filterFwhmMm(distance), footprintMm(pxPerMm));
}

/** Desendeki en ince iplik çapı (mm) — Lup'ta filtreli yola geçiş eşiği için. */
export function minYarnDiameterMm(input: FabricInput): number {
  return Math.min(...input.yarnTypes.map((y) => diameterMm(toTex(y.count, y.unit), y.yarnDensity ?? DEFAULT_YARN_DENSITY)));
}

/**
 * Filtrelenmiş (pişirilmiş + ön süzülmüş) yol mu, keskin ekran G-buffer yolu mu: Göz / Uzak her zaman filtreli;
 * Lup'ta iplik ~3 pikselin altına inince (ayak izi > d_min / 3) filtreli — keskin yol orada "tel elek" aliasing'i
 * üretir (VARSAYIM: 3 piksel / iplik, kesit profilinin çözülebildiği alt sınır).
 */
export const LOUPE_SHARP_PX_PER_YARN = 3;
export function useFilteredPath(distance: ViewDistance, pxPerMm: number, dMinMm: number): boolean {
  return distance !== 'loupe' || footprintMm(pxPerMm) > dMinMm / LOUPE_SHARP_PX_PER_YARN;
}

/**
 * Filtreli yolun pişirme yoğunluğu (texel / mm), 2'nin kuvveti kovası (zoom değişince yalnız kova değişirse yeniden
 * pişer — mip benzeri seviye seçimi; daha uzak zoom mip seviyelerinden okunur):
 *  - ekranın gösterebildiğinden (pxPerMm) fazlası gereksiz; filtrenin gösterebildiğinden (FWHM başına 8 texel) fazlası
 *    da gereksiz;
 *  - ama en az 3 texel / en ince iplik: ışık geçişi iplik geometrisini çözmeli. Alt-texel iplikte analitik kenar
 *    kapsaması aralık frekansında örnekleme hatası (moiré, düzenli şerit) üretir; mip zinciri bunu ayak izine
 *    doğru ortalar.
 * En çok 64 texel/mm.
 */
export const FILTER_TEXELS_PER_FWHM_MAX = 8;
export const BAKE_TEXELS_PER_YARN_MIN = 3;
export const FILTER_BAKE_MAX_PER_MM = 64;
export function filteredBakeDensity(fwhmMm: number, pxPerMm: number, dMinMm: number): number {
  let d = fwhmMm > 0 ? Math.min(pxPerMm, FILTER_TEXELS_PER_FWHM_MAX / fwhmMm) : pxPerMm;
  d = Math.max(d, BAKE_TEXELS_PER_YARN_MIN / dMinMm);
  d = Math.min(FILTER_BAKE_MAX_PER_MM, Math.max(2, d));
  return 2 ** Math.round(Math.log2(d));
}

/** Filtreli döşeme bütçesi: kenar ≤ MAX_TEXTURE_SIZE, toplam ≤ 8 M texel (sRGB + mip ≈ 43 MB). */
export const FILTER_BAKE_MAX_TEXELS = 8 * 1024 * 1024;

/** En büyük iplik aralığı (mm). */
export function maxPitchMm(input: FabricInput): number {
  return Math.max(pitchMm(input.density.warpPerCm), pitchMm(input.density.weftPerCm));
}

/**
 * Fiziksel ölçek ("Gerçek boyut" zoom ön ayarı): CSS pikseli → mm. VARSAYIM: CSS 96 dpi (CSS spesifikasyonunun
 * referans pikseli); gerçek ekranlar farklıdır, ayarlardaki kart kalibrasyonu (`calibration` çarpanı) düzeltir.
 */
export const CSS_DPI = 96;
export const MM_PER_INCH = 25.4;
export function cssPxPerMm(calibration = 1): number {
  return (CSS_DPI / MM_PER_INCH) * calibration;
}

/** Kredi kartı genişliği (ISO/IEC 7810 ID-1): ekran kalibrasyonu için referans. */
export const CARD_WIDTH_MM = 85.6;

/**
 * İplik başına doğal sapmanın (ton, kalınlığın alan payı) görüntülemede uygulandığı tablo uzunluğu (iplik).
 * Döşeme (12 mm, ~20–50 iplik) yerine 4096 iplik periyotlu: ≥ 20 döşeme, düzenli şerit tekrarı oluşmaz.
 */
export const THREAD_VARIATION_PERIOD = 4096;
