/**
 * Slot + rapor dizisinden iplik tabloları (referanstaki yarn_table).
 */
import type { YarnSlot } from '../types';
import { pmod } from '../heightfield/wave';
import { DEFAULT_YARN_DENSITY, diameterMm, toTex } from './yarnPhysics';

export interface SlotTable {
  tex: Float64Array;
  /** Çap (mm). */
  diameter: Float64Array;
  /** RGB 0..1, slot başına. */
  rgb: Array<[number, number, number]>;
  /** Büküm işareti: S = +1 (referans), Z = −1. */
  twistSign: Float64Array;
}

export function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.trim().replace(/^#/, '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full.slice(0, 6), 16);
  if (!Number.isFinite(n)) return [0.5, 0.5, 0.5];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function slotTable(slots: YarnSlot[], defaultYarnDensity?: number): SlotTable {
  if (slots.length === 0) throw new Error('En az bir iplik slotu gerekli.');
  const tex = new Float64Array(slots.length);
  const diameter = new Float64Array(slots.length);
  const twistSign = new Float64Array(slots.length);
  const rgb: Array<[number, number, number]> = [];
  slots.forEach((s, k) => {
    tex[k] = toTex(s.count, s.system);
    diameter[k] = diameterMm(tex[k], s.yarnDensity ?? defaultYarnDensity ?? DEFAULT_YARN_DENSITY);
    twistSign[k] = s.twist === 'Z' ? -1 : 1;
    rgb.push(hexToRgb01(s.color));
  });
  return { tex, diameter, rgb, twistSign };
}

/** Global iplik indeksi g için slot indeksi (rapor dizisi tekrar ederek). */
export function slotOf(sequence: number[], g: number, slotCount: number): number {
  if (sequence.length === 0) return 0;
  const s = sequence[pmod(g, sequence.length)];
  return s >= 0 && s < slotCount ? s : 0;
}

/** g = first .. first+count−1 için slot indeksleri. */
export function slotIndices(sequence: number[], first: number, count: number, slotCount: number): Int32Array {
  const out = new Int32Array(count);
  for (let k = 0; k < count; k++) out[k] = slotOf(sequence, first + k, slotCount);
  return out;
}
