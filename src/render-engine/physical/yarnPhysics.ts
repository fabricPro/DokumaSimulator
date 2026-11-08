/**
 * İplik fiziği: numara → tex → çap (mm). Karşılık: reference/weave_phys.py §1.
 */
import type { YarnSystem } from '../types';

export const DEFAULT_YARN_DENSITY = 0.85;

/** Numara sistemi adını normalize eder ('den', 'denye' → 'Denier' vb.). */
export function normalizeSystem(system: string): YarnSystem {
  const s = system.trim().toLowerCase();
  if (s === 'ne') return 'Ne';
  if (s === 'nm') return 'Nm';
  if (s === 'dtex') return 'Dtex';
  if (s === 'den' || s === 'denier' || s === 'denye') return 'Denier';
  if (s === 'tex') return 'Tex';
  throw new Error(`Bilinmeyen numara sistemi: ${system}`);
}

/** Ne: 590.5/Ne, Nm: 1000/Nm, Dtex: /10, Denier: /9, Tex: aynen. */
export function toTex(count: number, system: YarnSystem | string): number {
  if (!(count > 0)) throw new Error(`Geçersiz iplik numarası: ${count}`);
  switch (normalizeSystem(system)) {
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
  }
}

/**
 * d (mm) = 0.0357 · √(tex / ρ_iplik). ρ_iplik: iplik hacim yoğunluğu (g/cm³) =
 * lif yoğunluğu × paketleme. Filament PES ~1.0, spun ~0.8.
 */
export function diameterMm(tex: number, yarnDensity = DEFAULT_YARN_DENSITY): number {
  if (!(yarnDensity > 0)) throw new Error(`Geçersiz iplik yoğunluğu: ${yarnDensity}`);
  return 0.0357 * Math.sqrt(tex / yarnDensity);
}
