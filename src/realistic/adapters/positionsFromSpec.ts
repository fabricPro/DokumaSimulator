/**
 * FabricSpec → periyodik iplik konum tabloları (tarak + çekme yay modeli; render-engine/physical/shrinkDistribution)
 * ve paketleme girdisi. Gerçekçi render (fromSpec → FabricInput.positions) ve metrikler (açıklık / örtme) aynı
 * tablolardan beslenir: iki ayrı model kalmaz.
 *
 *  - Merkezler: AxisPositions.loom ya da .finished üreticisinden bir periyot (P iplik; P = lcm(örgü, dizi, tarak)).
 *  - Boş diş sınırı (yalnız çözgü, tarak varsa): komşu çözgü bir ya da daha fazla boş dişin öbür yanındaysa
 *    ipliğin o yana yayılması kendi dişinin kenarında biter (tezgahta). Mamulde sınır, o aralığın çekme oranıyla
 *    ölçeklenir (aralık g_mamul / g_tezgah).
 */
import type { FabricSpec } from '../../render-engine/types';
import { buildFabricPositions, type AxisPositions, type FabricPositions } from '../../render-engine/physical/shrinkDistribution';
import { slotOf, slotTable } from '../../render-engine/physical/yarns';
import { iplikToYarnType } from '../../adapters/iplik';
import { packAxis, packedOpenPct, packKind, resolvePacking, type AxisPack, type PackingOverrides, type PackKind } from '../packing';
import type { PeriodicCenters } from '../types';

export interface SpecAxisTable extends PeriodicCenters {
  /** Yuvarlak çap (mm) ve paketleme tipi, iplik başına (metrikler için). */
  diameters: Float64Array;
  kinds: PackKind[];
}

function periodOf(ax: AxisPositions, which: 'loom' | 'finished'): { centers: Float64Array; periodMm: number } {
  const gen = ax[which];
  const P = ax.period;
  // Gerçekçi modda iplik i, klasik render'ın g = i + 1 ipliğinin mm konumundadır (eşit aralıkta (i + 0.5)·p):
  // tablo g = 1 .. P'den alınır.
  const c = gen.centers(1, P + 1);
  // Periyot uzunluğu: c[P] − c[0] (periyodik üreticide tam periyot genişliği)
  return { centers: c.subarray(0, P), periodMm: c[P] - c[0] };
}

function slotKinds(spec: FabricSpec, slots: FabricSpec['warpSlots']): PackKind[] {
  return slots.map((s) => {
    const y = s.yarnId ? spec.yarns?.find((t) => t.id === s.yarnId) : undefined;
    if (!y) return packKind(undefined, 2);
    const t = iplikToYarnType(y);
    return packKind(t.structure, t.plies ?? 2);
  });
}

export function specAxisTables(
  spec: FabricSpec,
  which: 'loom' | 'finished',
  positions: FabricPositions = buildFabricPositions(spec),
): { warp: SpecAxisTable; weft: SpecAxisTable } {
  const mk = (ax: AxisPositions, slots: FabricSpec['warpSlots'], seq: number[], isWarp: boolean): SpecAxisTable => {
    const { centers, periodMm } = periodOf(ax, which);
    const P = ax.period;
    const t = slotTable(slots);
    const kinds = slotKinds(spec, slots);
    const diameters = new Float64Array(P);
    const kk: PackKind[] = [];
    for (let k = 0; k < P; k++) {
      const s = slotOf(seq, k + 1, slots.length);
      diameters[k] = t.diameter[s];
      kk.push(kinds[s]);
    }
    const out: SpecAxisTable = { centersMm: Float32Array.from(centers), periodMm, diameters, kinds: kk };
    const reed = isWarp ? positions.reed : undefined;
    if (reed) {
      const loom = ax.loom.centers(0, P + 2); // g = 0 .. P + 1
      const fin = which === 'finished' ? ax.finished.centers(0, P + 2) : loom;
      const limL = new Float32Array(P).fill(Infinity);
      const limR = new Float32Array(P).fill(Infinity);
      for (let k = 0; k < P; k++) {
        const g = k + 1;
        const dent = reed.dentOfWarp(g);
        const geo = reed.dentAt(dent);
        const a = g; // loom / fin dizisindeki yeri
        if (reed.dentOfWarp(g + 1) - dent >= 2) {
          const scale = (fin[a + 1] - fin[a]) / (loom[a + 1] - loom[a]);
          limR[k] = Math.max(0, (geo.right - loom[a]) * scale);
        }
        if (dent - reed.dentOfWarp(g - 1) >= 2) {
          const scale = (fin[a] - fin[a - 1]) / (loom[a] - loom[a - 1]);
          limL[k] = Math.max(0, (loom[a] - geo.left) * scale);
        }
      }
      out.limitLMm = limL;
      out.limitRMm = limR;
    }
    return out;
  };
  return {
    warp: mk(positions.warp, spec.warpSlots, spec.warpSequence, true),
    weft: mk(positions.weft, spec.weftSlots, spec.weftSequence, false),
  };
}

export function packSpecAxis(t: SpecAxisTable, packing?: PackingOverrides): AxisPack {
  return packAxis(
    { centers: t.centersMm, periodMm: t.periodMm, diameters: t.diameters, kinds: t.kinds, limitL: t.limitLMm, limitR: t.limitRMm },
    resolvePacking(packing),
  );
}

/** Paketleme modeliyle açıklık (%): mamul (varsayılan) ya da tezgah konumlarında. */
export function packedOpenPctOfSpec(
  spec: FabricSpec,
  which: 'loom' | 'finished' = 'finished',
  positions?: FabricPositions,
  packing?: PackingOverrides,
): number {
  const t = specAxisTables(spec, which, positions);
  return packedOpenPct(packSpecAxis(t.warp, packing), packSpecAxis(t.weft, packing));
}
