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
import type { FabricInput, Luster, PeriodicCenters, YarnType } from '../types';
import { specAxisTables, type SpecAxisTable } from './positionsFromSpec';
import { appliedShrinkPct } from '../../render-engine/physical/shrinkDistribution';
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
   * 'loom' (varsayılan): tezgah konumları (tarak varsa diş geometrisinden). 'finished': çekme yay modeli sonrası
   * mamul konumları (uygulanan çekme fiziksel sınırla kırpılmış). İkisi de `FabricInput.positions` ile (klasik
   * render'la aynı tablo: adapters/positionsFromSpec); sıklık = periyottaki iplik / periyot.
   */
  densities?: 'loom' | 'finished';
  /** false: eşit aralık (eski davranış; yalnız karşılaştırma için). Varsayılan true. */
  positions?: boolean;
}

export function fabricInputFromSpec(
  spec: FabricSpec,
  surface: SurfaceDefaults = DEFAULT_SURFACE,
  opts: SpecAdapterOptions = {},
): FabricInput {
  const wefts = spec.weave.length;
  const warps = spec.weave[0].length;
  // Gerçekçi tel i = klasik tel g = i + 1 (konum tablosu positionsFromSpec ile aynı): örgü sütun / satırı ve
  // diziler bir tel kaydırılır → aynı mm'deki tel klasik render'la aynı bağlantı, renk ve iplik tipini alır.
  const data = new Uint8Array(warps * wefts);
  for (let r = 0; r < wefts; r++) for (let c = 0; c < warps; c++) data[r * warps + c] = spec.weave[(r + 1) % wefts][(c + 1) % warps] ? 1 : 0;
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
    warp: rot1(seq(spec.warpSequence)).map((i) => ({ color: hex6(spec.warpSlots[i].color), yarnType: i })),
    weft: rot1(seq(spec.weftSequence)).map((i) => ({ color: hex6(spec.weftSlots[i].color), yarnType: nW + i })),
    yarnTypes,
    ...placement(spec, opts.densities ?? 'loom', opts.positions ?? true),
    shrink: { widthPct: spec.weftShrinkPct, lengthPct: spec.warpShrinkPct },
  };
}

/** Konum tablosu periyot üst sınırı (iplik; döşeme ve GPU tablo genişliği). */
export const MAX_POSITION_PERIOD = 2048;

/** Diziyi bir eleman sola döndürür: sonuç[i] = dizi[i + 1] (gerçekçi tel i = klasik tel i + 1). */
const rot1 = <T,>(a: T[]): T[] => a.map((_, i) => a[(i + 1) % a.length]);

function placement(spec: FabricSpec, kind: 'loom' | 'finished', usePositions: boolean): Pick<FabricInput, 'density' | 'positions'> {
  if (!usePositions) return { density: densityOf(spec, kind) };
  const t = specAxisTables(spec, kind);
  const strip = (a: SpecAxisTable): PeriodicCenters => ({
    centersMm: a.centersMm,
    periodMm: a.periodMm,
    ...(a.limitLMm ? { limitLMm: a.limitLMm, limitRMm: a.limitRMm } : {}),
  });
  // Çok uzun periyot (EKOK patlaması) GPU iplik tablosuna sığmaz: o eksende ortalama sıklıkla eşit aralık
  const fallback = densityOf(spec, kind);
  const ok = (a: SpecAxisTable) => a.centersMm.length <= MAX_POSITION_PERIOD;
  return {
    density: {
      warpPerCm: ok(t.warp) ? (10 * t.warp.centersMm.length) / t.warp.periodMm : fallback.warpPerCm,
      weftPerCm: ok(t.weft) ? (10 * t.weft.centersMm.length) / t.weft.periodMm : fallback.weftPerCm,
    },
    positions: { ...(ok(t.warp) ? { warp: strip(t.warp) } : {}), ...(ok(t.weft) ? { weft: strip(t.weft) } : {}) },
  };
}

function densityOf(spec: FabricSpec, kind: 'loom' | 'finished'): FabricInput['density'] {
  const warpPerCm = effectiveLoomWarpDensity(spec);
  const weftPerCm = effectiveLoomWeftDensity(spec);
  if (kind === 'loom') return { warpPerCm, weftPerCm };
  const a = appliedShrinkPct(spec);
  const f = finishedDensities(warpPerCm, weftPerCm, a.warp, a.weft);
  return { warpPerCm: f.warp, weftPerCm: f.weft };
}
