/**
 * Örnek girdiler: bantlı çözgü fixture'ının açılması ve snapshot örgüleri.
 * Çekirdek API'nin parçası değildir (index.ts dışa açmaz); snapshot sayfası ve testler kullanır.
 */
import type { CountUnit, FabricInput, Luster, YarnType } from './types';

export type BandWeave = 'plain' | 'twill22-Z' | 'twill22-S' | 'twill31-Z' | 'twill31-S';

export interface BandedFixture {
  name: string;
  warpBands: Array<{ ends: number; color: string; label?: string; weave: BandWeave }>;
  weftRepeat: number;
  weft: { color: string };
  density: { warpPerCm: number; weftPerCm: number };
  yarn: { count: number; unit: CountUnit; twist: 'S' | 'Z'; twistPerM?: number; luster: Luster; hairiness: number };
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Bant örgüsü: c = global çözgü indeksi (bantlar boyunca kesintisiz köşegen), r = atkı (0 alt). */
export function bandCell(weave: BandWeave, c: number, r: number): boolean {
  switch (weave) {
    case 'plain':
      return mod(c + r, 2) === 0;
    case 'twill22-Z':
      return mod(c - r, 4) < 2;
    case 'twill22-S':
      return mod(c + r, 4) < 2;
    case 'twill31-Z':
      return mod(c - r, 4) < 3;
    case 'twill31-S':
      // Hedef görüntüyle (prototip) aynı köşegen (sol üstten sağ alta); prototip satırı j (aşağı) = −r
      return mod(c + r, 4) < 3;
  }
}

/** Bant tanımını tek birleşik matrise ve iplik dizilerine açar. */
export function expandBandedFixture(f: BandedFixture): FabricInput {
  const bandOf: number[] = [];
  f.warpBands.forEach((b, bi) => {
    for (let k = 0; k < b.ends; k++) bandOf.push(bi);
  });
  const warps = bandOf.length;
  const wefts = f.weftRepeat;
  const data = new Uint8Array(warps * wefts);
  for (let r = 0; r < wefts; r++) {
    for (let c = 0; c < warps; c++) data[r * warps + c] = bandCell(f.warpBands[bandOf[c]].weave, c, r) ? 1 : 0;
  }
  const yarn: YarnType = { ...f.yarn };
  return {
    weave: { warps, wefts, data },
    warp: bandOf.map((bi) => ({ color: f.warpBands[bi].color, yarnType: 0 })),
    weft: [{ color: f.weft.color, yarnType: 0 }],
    yarnTypes: [yarn],
    density: { ...f.density },
  };
}

/** Matris satırlarından (satır 0 = atkı 0, alt) FabricInput. */
export function inputFromRows(
  rows: boolean[][],
  warpColor: string,
  weftColor: string,
  density = { warpPerCm: 30, weftPerCm: 26 },
): FabricInput {
  const wefts = rows.length;
  const warps = rows[0].length;
  const data = new Uint8Array(warps * wefts);
  rows.forEach((row, r) => row.forEach((v, c) => (data[r * warps + c] = v ? 1 : 0)));
  return {
    weave: { warps, wefts, data },
    warp: [{ color: warpColor, yarnType: 0 }],
    weft: [{ color: weftColor, yarnType: 1 }],
    yarnTypes: [
      { count: 20, unit: 'Ne', twist: 'Z', twistPerM: 700, luster: 'mat', hairiness: 0.3 },
      { count: 150, unit: 'Denier', twist: 'S', twistPerM: 300, luster: 'parlak', hairiness: 0.05 },
    ],
    density,
  };
}
