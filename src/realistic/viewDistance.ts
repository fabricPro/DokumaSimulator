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
 * Algısal filtre. `resolvableMm` gözün o mesafede ayırt edebildiği EN KÜÇÜK DETAY'dır: 1 yay dakikası = bir çevrim
 * (çizgi + boşluk çifti) — Göz (40 cm) ≈ 0.12 mm, Uzak (2 m) ≈ 0.6 mm. Bu bir bulanıklık yarıçapı DEĞİL, çözünürlük
 * sınırıdır: periyodu bundan uzun detay (ör. 0.5 mm'lik örgü hücresi) olduğu gibi seçilir, kısa periyotlu detay
 * (iplik içi büküm / lif) söner.
 *
 * Gauss σ = çözünürlük / 2.5. Gerekçe: Gauss'un modülasyon aktarım fonksiyonu MTF(f) = exp(−2π²σ²f²); sınır
 * frekansında f = 1 / çözünürlük için MTF = exp(−2π² / 2.5²) = %4.2 (gözün kontrast eşiği ≈ %2–5 → sınırda kaybolur);
 * periyodu 4 × çözünürlük olan detayda (Göz'de 0.5 mm) MTF = %78 — seçilebilir kalır.
 */
export const SIGMA_PER_RESOLUTION = 1 / 2.5;
export function filterSigmaMm(distance: ViewDistance): number {
  return distance === 'loupe' ? 0 : resolvableMm(VIEW_DISTANCE_MM[distance]) * SIGMA_PER_RESOLUTION;
}

/** Gauss σ = FWHM / (2·√(2·ln 2)) ≈ FWHM / 2.355. */
export const FWHM_PER_SIGMA = 2 * Math.sqrt(2 * Math.LN2);
export function sigmaFromFwhm(fwhmMm: number): number {
  return fwhmMm / FWHM_PER_SIGMA;
}
/** Filtre tam genişlik yarı yükseklik (FWHM, mm) = 2.355·σ (mip / LOD hesapları FWHM kullanır). */
export function filterFwhmMm(distance: ViewDistance): number {
  return filterSigmaMm(distance) * FWHM_PER_SIGMA;
}

/**
 * Net çizime geçiş (zoom ile): algısal filtrenin ekrandaki büyüklüğü σ_px = σ_mm · px/mm. σ_px ≤ 1.5 iken görüntü
 * filtreli (pişirilmiş) yoldur; 1.5 px'i aştıktan sonra bulanıklaştırma ARTMAZ — net (lup tipi, "malzeme" karakterli)
 * çizime yumuşakça geçilir: ağırlık log(σ_px)'de smoothstep, 1.5 → 4 px (≈ 1.4 oktav ≈ 3 zoom adımı). VARSAYIM:
 * 1.5 px (filtrenin bir pikselden belirgin büyük olduğu eşik), 4 px (tam net).
 */
export const SHARP_BLEND_START_PX = 1.5;
export const SHARP_BLEND_END_PX = 4;
export function sharpBlend(sigmaPx: number): number {
  if (!(sigmaPx > SHARP_BLEND_START_PX)) return 0;
  const t = Math.log(sigmaPx / SHARP_BLEND_START_PX) / Math.log(SHARP_BLEND_END_PX / SHARP_BLEND_START_PX);
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}
/** Bu zoom'da net çizim ağırlığı: Lup'ta 0 (kendi mantığı), Göz / Uzak'ta σ_px'e göre. */
export function sharpWeight(distance: ViewDistance, pxPerMm: number): number {
  return distance === 'loupe' ? 0 : sharpBlend(filterSigmaMm(distance) * pxPerMm);
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

/**
 * Pişirme texel bütçesi (her yol): kenar ≤ MAX_TEXTURE_SIZE ve toplam ≤ 2.5 M texel. Pişirme sırasındaki geçici bellek
 * ≈ 50 bayt / texel (G-buffer 4 hedef × 8 B + ao + renk + mip + ön filtre) → ≈ 125 MB; eski 8 M texel (≈ 400 MB)
 * iki bağlamda (Tezgah + Mamul) bellek yetersizliğine yol açabiliyordu. VARSAYIM; aşılırsa yoğunluk düşürülür.
 */
export const FILTER_BAKE_MAX_TEXELS = 2_500_000;

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

/**
 * LRU tahliyesi (saf, testli): `entries` en az kullanılandan en çok kullanılana sıralıdır. Toplam bayt `capBytes`'ı
 * aşıyorsa `keep` dışındaki en eskiler sırayla tahliye listesine alınır (en az bir kayıt hep kalır).
 */
export function lruEvictions<T>(entries: Array<{ id: T; bytes: number }>, keep: T, capBytes: number): T[] {
  let total = entries.reduce((a, e) => a + e.bytes, 0);
  const out: T[] = [];
  for (const e of entries) {
    if (total <= capBytes || entries.length - out.length <= 1) break;
    if (e.id === keep) continue;
    out.push(e.id);
    total -= e.bytes;
  }
  return out;
}

/**
 * Göz / Uzak "malzeme" karakteri (net çizimde ve filtreli pişirmede aynı, geçiş tutarlı olsun): gözle bakılan kumaş
 * kapalı yüzeyli, iplik içi detay orta düzeyde, siyah boşluk yok. Kullanıcının verdiği Tuning değerleri ezer.
 * VARSAYIM (gözle seçildi): rölyef 0.5 (büküm / lif kabartması yarıya), melanj 0.7, tüylülük 0.5,
 * yayılma ×2.2 (iplik araları kapanır: viewDistance → geometry.spreadFactor), yumuşak kenar 0.12·a
 * (iplik kenarında lif dolgusu: kapsama geçişi kesit yarı genişliğinin %12'si).
 */
export const MATERIAL_DEFAULTS = { relief: 0.5, melange: 0.7, hairiness: 0.5, spread: 2.2, softEdge: 0.12 } as const;
export function materialTuning<T extends object>(distance: ViewDistance, tuning?: T): T & typeof MATERIAL_DEFAULTS {
  return (distance === 'loupe' ? { ...(tuning ?? {}) } : { ...MATERIAL_DEFAULTS, ...(tuning ?? {}) }) as T & typeof MATERIAL_DEFAULTS;
}

/**
 * Görüntülemede iplik ton farkı (ΔE) ölçeği: varsayılan Faz 4 ΔE 1.5 → ≈ 1.0 (kumaş ölçeğinde fark edilir ama baskın
 * değil; "bulut" olmasın). Kullanıcının irregularity çarpanı / ΔE değeri bu ölçekle çarpılır.
 */
export const VIEW_TONE_DE_SCALE = 2 / 3;
