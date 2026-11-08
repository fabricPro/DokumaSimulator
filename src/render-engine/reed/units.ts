import type { ReedUnit } from './types';

/** Tarak numarasını diş/cm'ye çevirir. */
export function toDentsPerCm(reedNumber: number, unit: ReedUnit = 'diş/cm'): number {
  switch (unit) {
    case 'diş/cm':
      return reedNumber;
    case 'diş/10cm':
      return reedNumber / 10;
    case 'diş/inç':
      return reedNumber / 2.54;
  }
}

/** diş/cm'yi istenen birime çevirir. */
export function fromDentsPerCm(dentsPerCm: number, unit: ReedUnit = 'diş/cm'): number {
  switch (unit) {
    case 'diş/cm':
      return dentsPerCm;
    case 'diş/10cm':
      return dentsPerCm * 10;
    case 'diş/inç':
      return dentsPerCm * 2.54;
  }
}

/** Diş adımı (mm) = 10 / diş/cm. */
export function dentPitchMm(dentsPerCm: number): number {
  if (!(dentsPerCm > 0)) throw new Error('Tarak sıklığı pozitif olmalı.');
  return 10 / dentsPerCm;
}
