/**
 * Tarak tipleri. Tarak yalnız çözgü yönünde tezgah konumlarını belirler; atkı yönünde tarak yoktur.
 */

export type ReedUnit = 'diş/cm' | 'diş/10cm' | 'diş/inç';
export const REED_UNITS: ReedUnit[] = ['diş/cm', 'diş/10cm', 'diş/inç'];

export interface ReedSpec {
  /** Tarak numarası, `reedUnit` biriminde. */
  reedNumber: number;
  /** Varsayılan 'diş/cm'. */
  reedUnit?: ReedUnit;
  /** Diş telinin adıma oranı (0..1). Varsayılan 0.30. Dişin açık genişliği = p·(1 − wireRatio). */
  wireRatio?: number;
  /** Diş başına tel sayısı raporu; 0 = boş diş. Ör. [3,0], [2,2,3,0,0]. */
  dentingReport: number[];
  /** Tarak eni (cm), opsiyonel. Verilirse toplam diş / tel / rapor sayısı hesaplanır. */
  reedWidthCm?: number;
  /** Rapora hangi dişten başlanacağı (0 tabanlı). */
  startOffset?: number;
}

export const DEFAULT_WIRE_RATIO = 0.3;

/**
 * Tahar planı arayüzü: çözgülerin dişlere dağıtım sırası.
 * Şimdilik özdeşlik (çözgü indeksi sırası); ayrı bir tahar planı ileride bunu uygulayarak bağlanır.
 */
export interface DrawingInPlan {
  /** Global çözgü indeksi g'nin dişlere dağıtım sırasındaki yeri. */
  dentSequenceIndex(warpIndex: number): number;
}

export const IDENTITY_DRAWING_IN: DrawingInPlan = { dentSequenceIndex: (g) => g };

/** Eski (v2.1 taslağı) tarak biçimi: { densityPerCm, denting }. */
export interface LegacyReedSpec {
  densityPerCm: number;
  denting: number[];
}

/** Eski veya yeni biçimi ReedSpec'e çevirir; tanınmazsa undefined. */
export function normalizeReedSpec(raw: unknown): ReedSpec | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Partial<ReedSpec & LegacyReedSpec>;
  if (Array.isArray(r.dentingReport) && typeof r.reedNumber === 'number') {
    return {
      reedNumber: r.reedNumber,
      reedUnit: r.reedUnit ?? 'diş/cm',
      ...(r.wireRatio !== undefined ? { wireRatio: r.wireRatio } : {}),
      dentingReport: r.dentingReport.slice(),
      ...(r.reedWidthCm !== undefined ? { reedWidthCm: r.reedWidthCm } : {}),
      ...(r.startOffset !== undefined ? { startOffset: r.startOffset } : {}),
    };
  }
  if (Array.isArray(r.denting) && typeof r.densityPerCm === 'number') {
    return { reedNumber: r.densityPerCm, reedUnit: 'diş/cm', dentingReport: r.denting.slice() };
  }
  return undefined;
}
