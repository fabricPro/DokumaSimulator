/**
 * Faz 3 yüzey modeli (saf; ışık shader'ının parametreleri ve CPU ikizleri).
 * Tüm sayısal sabitler VARSAYIMDIR; gerçek numune fotoğraflarıyla (Faz 5) kalibre edilecek.
 */
import type { Luster, Quality } from './types';

/**
 * Büküm (sarmal) açısı: tan θ = π·d·T. d = iplik çapı (mm), T = büküm (tur/mm).
 * Kaynak: iplik geometrisinde yüzey lifinin sarmal açısı (Hearle; Morton & Hearle). Lifler bu açıyla
 * eğik durduğu için büküm şeritleri ve parlama çizgileri iplik eksenine θ kadar eğiktir.
 */
export function twistAngle(diameterMm: number, turnsPerMm: number): number {
  return Math.atan(Math.PI * diameterMm * Math.abs(turnsPerMm));
}

/** VARSAYIM: 2 katlı iplik → her turda 2 kat yüzeye çıkar; eksen boyunca oluk aralığı 1 / (kat·T). */
export const PLY_COUNT = 2;
export function grooveSpacingMm(turnsPerMm: number, plies = PLY_COUNT): number {
  if (!(Math.abs(turnsPerMm) > 0)) return Infinity;
  return 1 / (plies * Math.abs(turnsPerMm));
}

/**
 * ESKİ (Faz 3, artık shader'da kullanılmıyor; LUSTER_KK_MUL'a bakın).
 * Parlaklık sınıfı → Kajiya-Kay anizotropik parlama (şiddet, üs).
 * VARSAYIM: mat (pamuk) geniş ve zayıf, parlak (polyester filament) dar ve güçlü.
 */
export const LUSTER_SPECULAR: Record<Luster, { strength: number; exponent: number }> = {
  mat: { strength: 0.04, exponent: 8 },
  yarimat: { strength: 0.12, exponent: 24 },
  parlak: { strength: 0.35, exponent: 64 },
};
export const LUSTER_ORDER: Luster[] = ['mat', 'yarimat', 'parlak'];

/**
 * Kalite → AO ölçek sayısı (1..3: 0.35 / 0.9 / 2.0 aralık) ve yönlü gölge adımı (0 = kapalı).
 * fix-v2: yüksek = her şey açık; orta = gölge adımları yarıya, 2 ölçek AO; düşük = gölge kapalı, tek ölçek AO.
 */
export const QUALITY_SAMPLES: Record<Quality, { ao: number; shadow: number }> = {
  low: { ao: 1, shadow: 0 },
  medium: { ao: 2, shadow: 24 },
  high: { ao: 3, shadow: 48 },
};

/**
 * fix-v2 Kajiya-Kay (prototip): iki lob 0.05·s^12 + 0.10·s^90, teğet = iplik ekseni. Parlaklık sınıfı
 * şiddeti ölçekler. VARSAYIM (kalibre edilecek): mat (pamuk, prototip) 1, yarı mat 1.8, parlak 3.5.
 */
export const LUSTER_KK_MUL: Record<Luster, number> = { mat: 1, yarimat: 1.8, parlak: 3.5 };
export const KK_LOBES = [
  { strength: 0.05, exponent: 12 },
  { strength: 0.1, exponent: 90 },
] as const;
/** Prototip çıkış pozlaması (to_srgb(col·1.25)). VARSAYIM. */
export const EXPOSURE = 1.25;

/** sRGB (0..1) → doğrusal. */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Doğrusal → sRGB (0..1). */
export function linearToSrgb(c: number): number {
  const x = Math.min(1, Math.max(0, c));
  return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

/** Yumuşak tavan (referans weave_phys.py ile aynı biçim): beyaz iplikler patlamasın. */
export function softClip(c: number): number {
  return (c / (1 + 0.35 * c)) * 1.35;
}
