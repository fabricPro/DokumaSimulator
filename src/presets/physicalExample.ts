/**
 * reference/weave_phys.py `__main__` örneği: armür motifi, 2 çözgü + 4 atkı slotu.
 */
import type { FabricSpec } from '../render-engine';
import { dobbyFancy } from './weaves';

export function physicalExample(warpShrinkPct = 0, weftShrinkPct = 0): FabricSpec {
  return {
    version: 2,
    weave: dobbyFancy(),
    warpSlots: [
      { name: 'A', count: 300, system: 'Denier', color: '#e8e6e1', twist: 'S' },
      { name: 'B', count: 300, system: 'Denier', color: '#3d434b', twist: 'S' },
    ],
    warpSequence: [0, 1, 1, 0, 1, 1],
    weftSlots: [
      { name: 'A', count: 600, system: 'Denier', color: '#3d434b', twist: 'S' }, // kalın gri
      { name: 'B', count: 150, system: 'Denier', color: '#3fc0d2', twist: 'S' }, // ince turkuaz
      { name: 'C', count: 8, system: 'Ne', color: '#c9a24a', yarnDensity: 0.7, twist: 'S' }, // şönil benzeri
      { name: 'D', count: 300, system: 'Denier', color: '#e8e6e1', twist: 'S' }, // beyaz
    ],
    weftSequence: [0, 1, 0, 2, 0, 3],
    warpDensityLoom: 22,
    weftDensityLoom: 18,
    warpShrinkPct,
    weftShrinkPct,
    warpCrimpShare: 0.4,
  };
}

/** Referanstaki üç durum: ad, çözgü çekmesi %, atkı çekmesi %. */
export const PHYSICAL_CASES: Array<[string, number, number]> = [
  ['tezgah', 0, 0],
  ['mamul_orta', 6, 10],
  ['mamul_yuksek', 12, 20],
];
