import type { YarnSpec } from './types';

/** Polyester için varsayılan lif yoğunluğu (g/cm³). */
export const DEFAULT_FIBER_DENSITY = 1.38;

/** İplik numarasını tex'e çevirir. */
export function toTex(yarn: Pick<YarnSpec, 'count' | 'system'>): number {
  const { count, system } = yarn;
  if (!(count > 0)) throw new Error(`Geçersiz iplik numarası: ${count}`);
  switch (system) {
    case 'Ne':
      return 590.5 / count;
    case 'Nm':
      return 1000 / count;
    case 'Dtex':
      return count / 10;
    case 'Denier':
      return count / 9;
    case 'Tex':
      return count;
    default:
      throw new Error(`Bilinmeyen numara sistemi: ${String(system)}`);
  }
}

/** İplik çapı (mm): d ≈ 0.0357 · √(tex / ρ). */
export function yarnDiameterMm(yarn: YarnSpec): number {
  const rho = yarn.fiberDensity ?? DEFAULT_FIBER_DENSITY;
  if (!(rho > 0)) throw new Error(`Geçersiz lif yoğunluğu: ${rho}`);
  return 0.0357 * Math.sqrt(toTex(yarn) / rho);
}

/** İplik aralığı (mm) = 10 / sıklık (tel/cm). */
export function spacingMm(densityPerCm: number): number {
  if (!(densityPerCm > 0)) throw new Error(`Geçersiz sıklık: ${densityPerCm}`);
  return 10 / densityPerCm;
}

export interface YarnGeometry {
  tex: number;
  /** Teorik iplik çapı (mm). */
  diameter: number;
  /** Merkezden merkeze iplik aralığı (mm). */
  spacing: number;
  /** Görünen iplik genişliği (mm) = min(çap, aralık). */
  width: number;
  /** İplikler arası boşluk (mm), ≥ 0. */
  gap: number;
  /** çap / aralık. > 1 ise iplik sıkışmış (yassılmış) görünür. */
  compression: number;
}

export function yarnGeometry(yarn: YarnSpec, densityPerCm: number): YarnGeometry {
  const tex = toTex(yarn);
  const diameter = yarnDiameterMm(yarn);
  const spacing = spacingMm(densityPerCm);
  return {
    tex,
    diameter,
    spacing,
    width: Math.min(diameter, spacing),
    gap: Math.max(0, spacing - diameter),
    compression: diameter / spacing,
  };
}
