/**
 * FabricSpec → periyodik iplik konum tabloları (tarak + çekme yay modeli; render-engine/physical/shrinkDistribution)
 * ve paketleme girdisi. Gerçekçi render (fromSpec → FabricInput.positions) ve metrikler (açıklık / örtme) aynı
 * tablolardan beslenir: iki ayrı model kalmaz.
 *
 *  - Merkezler: AxisPositions.loom ya da .finished üreticisinden bir periyot (P iplik; P = lcm(örgü, dizi, tarak)).
 *  - Tarak duvarları (yalnız çözgü, tarak varsa; render-engine/physical/warpLayout.ts): her tel kendi dişinin
 *    sınırları içinde kalır (limitL/R); mamulde duvar payı yandaki aralığın çekme oranıyla ölçeklenir.
 */
import type { FabricSpec } from '../../render-engine/types';
import { buildFabricPositions, type FabricPositions } from '../../render-engine/physical/shrinkDistribution';
import { threadLayout, type AxisThreadLayout } from '../../render-engine/physical/warpLayout';
import { slotOf, slotTable } from '../../render-engine/physical/yarns';
import { iplikToYarnType } from '../../adapters/iplik';
import { packAxis, packedOpenPct, packKind, resolvePacking, type AxisPack, type PackingOverrides, type PackKind } from '../packing';
import type { PeriodicCenters } from '../types';

export interface SpecAxisTable extends PeriodicCenters {
  /** Yuvarlak çap (mm) ve paketleme tipi, iplik başına (metrikler için). */
  diameters: Float64Array;
  kinds: PackKind[];
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
  // Tek kaynak (warpLayout.ts). Gerçekçi tel i = klasik tel g = i + 1 (gerçekçi eşit aralık (i + 0.5)·p =
  // klasik (g − 0.5)·p); adaptör (fromSpec) örgü / dizileri de aynı bir tel kaydırır → aynı tel aynı yerde ve aynı
  // bağlantıyla çizilir.
  const lay = threadLayout(spec, which, positions, 1);
  const mk = (l: AxisThreadLayout, slots: FabricSpec['warpSlots'], seq: number[]): SpecAxisTable => {
    const P = l.period;
    const t = slotTable(slots);
    const kinds = slotKinds(spec, slots);
    const diameters = new Float64Array(P);
    const kk: PackKind[] = [];
    for (let k = 0; k < P; k++) {
      const s = slotOf(seq, l.first + k, slots.length);
      diameters[k] = t.diameter[s];
      kk.push(kinds[s]);
    }
    const out: SpecAxisTable = { centersMm: Float32Array.from(l.centers), periodMm: l.periodMm, diameters, kinds: kk };
    if (l.wallL && l.wallR) {
      out.limitLMm = Float32Array.from(l.wallL);
      out.limitRMm = Float32Array.from(l.wallR);
    }
    return out;
  };
  return { warp: mk(lay.warp, spec.warpSlots, spec.warpSequence), weft: mk(lay.weft, spec.weftSlots, spec.weftSequence) };
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
