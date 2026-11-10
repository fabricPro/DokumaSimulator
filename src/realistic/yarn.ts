/**
 * İplik fiziği (saf). render-engine/physical/yarnPhysics.ts ile aynı formüller; modül Tezgah'a tek
 * başına taşınabilsin diye bağımlılık yerine kopya tutulur (eşitlik testle doğrulanır).
 */
import type { CountUnit } from './types';

/** Numara → tex. Ne: 590.5/Ne, Nm: 1000/Nm, Dtex: /10, Denier: /9, Tex: aynen. */
export function toTex(count: number, unit: CountUnit): number {
  if (!(count > 0)) throw new Error(`Geçersiz iplik numarası: ${count}`);
  switch (unit) {
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

/** Varsayılan iplik hacim yoğunluğu (g/cm³). */
export const DEFAULT_YARN_DENSITY = 0.85;

/**
 * Çap (mm): d = 0.0357·√(tex / ρ).
 * VARSAYIM: ρ iplik hacim yoğunluğu = lif yoğunluğu × paketleme oranı. Polyester filament ~1.0,
 * pamuk/spun ~0.8; varsayılan 0.85. Gerçek numune kesitleriyle kalibre edilecek.
 */
export function diameterMm(tex: number, yarnDensity = DEFAULT_YARN_DENSITY): number {
  if (!(yarnDensity > 0)) throw new Error(`Geçersiz iplik yoğunluğu: ${yarnDensity}`);
  return 0.0357 * Math.sqrt(tex / yarnDensity);
}
