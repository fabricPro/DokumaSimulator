/**
 * Dokuma Simülatörü FabricSpec → FabricInput adaptörü (uygulama tarafı; çekirdek dışa açmaz).
 * Tezgah için benzer bir adaptör INTEGRATION.md'de tarif edilir.
 *
 * Eşleme:
 *  - weave: FabricSpec.weave[atkı][çözgü] aynı yönelim (atkı 0 alt) → düz dizi.
 *  - iplik tipleri: önce çözgü slotları, sonra atkı slotları (slot başına bir tip).
 *  - çözgü/atkı dizileri: slot sıra raporu (warpSequence / weftSequence) → renk + tip.
 *  - sıklık: tarak varsa taraktan türetilen, atkı raporu varsa ortalama tezgah sıklığı.
 *  - FabricSpec'te olmayan yüzey alanları (parlaklık, tüylülük, büküm sıklığı) için varsayılanlar.
 */
import type { FabricSpec } from '../../render-engine/types';
import { effectiveLoomWarpDensity, effectiveLoomWeftDensity } from '../../render-engine/physical/metrics';
import { finishedDensities } from '../../render-engine/physical/shrinkage';
import type { FabricInput, Luster, YarnType } from '../types';
import { iplikToYarnType } from '../../adapters/iplik';

export interface SurfaceDefaults {
  luster: Luster;
  hairiness: number;
  twistPerM?: number;
}

export const DEFAULT_SURFACE: SurfaceDefaults = { luster: 'yarimat', hairiness: 0.2 };

/** '#abc' → '#aabbcc'; geçersizse gri. */
function hex6(c: string): string {
  const h = c.trim().replace(/^#/, '');
  if (/^[0-9a-f]{6}$/i.test(h)) return '#' + h.toLowerCase();
  if (/^[0-9a-f]{3}$/i.test(h)) return '#' + h.split('').map((x) => x + x).join('').toLowerCase();
  return '#808080';
}

export interface SpecAdapterOptions {
  /**
   * 'loom' (varsayılan): tezgah sıklığı. 'finished': çekme sonrası ORTALAMA mamul sıklığı.
   * VARSAYIM / sınır: gerçekçi mod şimdilik eşit aralık kullanır; CPU mamul render'ındaki bağlantıya
   * göre değişen aralık (yay modeli) ve tarak gruplaması `FabricInput.positions` ile ileride bağlanacak.
   */
  densities?: 'loom' | 'finished';
}

export function fabricInputFromSpec(
  spec: FabricSpec,
  surface: SurfaceDefaults = DEFAULT_SURFACE,
  opts: SpecAdapterOptions = {},
): FabricInput {
  const wefts = spec.weave.length;
  const warps = spec.weave[0].length;
  const data = new Uint8Array(warps * wefts);
  spec.weave.forEach((row, r) => row.forEach((v, c) => (data[r * warps + c] = v ? 1 : 0)));
  // Slot bir iplik tanımına bağlıysa (.atki.json demoları) tip, kat, parlaklık, tüylülük ve büküm ondan
  const linked = (s: FabricSpec['warpSlots'][number]) => (s.yarnId ? spec.yarns?.find((y) => y.id === s.yarnId) : undefined);
  const toType = (s: FabricSpec['warpSlots'][number]): YarnType => {
    const y = linked(s);
    if (!y) return toTypeLegacy(s);
    // Slot numarası / sistemi kullanıcı panelden değiştirmiş olabilir: sonuç numara slottan, geri kalan tanımdan
    const t = iplikToYarnType(y);
    return { ...t, count: s.count, unit: s.system, twist: s.twist, ...(s.yarnDensity ? { yarnDensity: s.yarnDensity } : {}) };
  };
  const toTypeLegacy = (s: FabricSpec['warpSlots'][number]): YarnType => ({
    count: s.count,
    unit: s.system,
    twist: s.twist,
    ...(surface.twistPerM ? { twistPerM: surface.twistPerM } : {}),
    luster: surface.luster,
    hairiness: surface.hairiness,
    ...(s.yarnDensity ? { yarnDensity: s.yarnDensity } : {}),
  });
  const yarnTypes = [...spec.warpSlots.map(toType), ...spec.weftSlots.map(toType)];
  const nW = spec.warpSlots.length;
  const seq = (list: number[]) => (list.length ? list : [0]);
  return {
    weave: { warps, wefts, data },
    warp: seq(spec.warpSequence).map((i) => ({ color: hex6(spec.warpSlots[i].color), yarnType: i })),
    weft: seq(spec.weftSequence).map((i) => ({ color: hex6(spec.weftSlots[i].color), yarnType: nW + i })),
    yarnTypes,
    density: densityOf(spec, opts.densities ?? 'loom'),
    shrink: { widthPct: spec.weftShrinkPct, lengthPct: spec.warpShrinkPct },
  };
}

function densityOf(spec: FabricSpec, kind: 'loom' | 'finished'): FabricInput['density'] {
  const warpPerCm = effectiveLoomWarpDensity(spec);
  const weftPerCm = effectiveLoomWeftDensity(spec);
  if (kind === 'loom') return { warpPerCm, weftPerCm };
  const f = finishedDensities(warpPerCm, weftPerCm, spec.warpShrinkPct, spec.weftShrinkPct);
  return { warpPerCm: f.warp, weftPerCm: f.weft };
}
