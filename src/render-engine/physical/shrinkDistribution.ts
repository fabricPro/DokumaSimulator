/**
 * Çekme dağılımı: yay modeli.
 *
 * Çekme ipliklerin hepsini eşit sıklaştırmaz. Komşu iki iplik arasındaki her aralık bir yaydır:
 *   - tezgah aralığı g0_k (tarak ya da düzgün üreticiden),
 *   - en küçük aralık m_k = c·(r_k + r_k+1) + t_k
 *       c   : racetrack sıkışma katsayısı (Love 1954 racetrack kesiti; Seyam & El-Shiekh sıkılık
 *             faktörü), iplikler değdiğinde kesitin yanlardan yassılmasıyla ulaşılabilen yakınlık,
 *       t_k : aralarından geçen karşı ipliklerin çapı (Ashenhurst: her geçiş bir çap yer kaplar),
 *             = w_k·d_karşı tek karşı iplikte,
 *   - sertlik k_k = 1 + (ρ − 1)·w_k: bağlantısız aralık (w = 0) yumuşak, bağlantılı aralık sert.
 * Hedef genişlik W = W0·(1 − çekme); açık Δ = W0 − W aralıklara 1/k_k oranında dağıtılır, m_k'ya
 * dayanan aralık sabitlenir, kalan açık serbest aralıklara yeniden dağıtılır (su doldurma).
 *
 * Sonuç: bezayağı/dimi gibi tüm aralıkları eşit bağlanan örgüler eşit sıklaşır; panama ve yalancı
 * linoda aynı hareketi yapan iplikler önce toplanır, ters bağlanan sınırlar açık kalır (gözenek).
 * Serbest "gruplaşma" parametresi yoktur; gruplaşma çekmenin ve örgünün kendisinden doğar.
 * İplik boyunca konum sabittir (yanal bükülme kapsam dışı).
 */
import type { FabricSpec } from '../types';
import { crossWeightedGap, warpGapBinding, weftGapBinding } from './interlacing';
import {
  PeriodicPositionGenerator,
  UniformPositionGenerator,
  lcm,
  type PositionGenerator,
} from './positions';
import { ReedPositionGenerator } from '../reed/layout';
import { MIN_SQUEEZE } from './squeeze';
import { slotOf, slotTable } from './yarns';

export const DEFAULT_RELAX = { c: 0.85, rho: 8 };
/** Periyot üst sınırı (EKOK patlamasına karşı). */
const MAX_PERIOD = 20000;

export interface SpringInput {
  /** Tezgah aralıkları g0_k (k = 0..P−1; aralık k: iplik k ile k+1 arası, döngüsel). */
  loomGaps: Float64Array;
  /** En küçük aralıklar m_k. */
  minGaps: Float64Array;
  /** Sertlikler k_k (> 0). */
  stiffness: Float64Array;
  /** Hedef çekme, 0..1. */
  shrink: number;
}

export interface SpringResult {
  gaps: Float64Array;
  /** Hedef genişliğe ulaşıldı mı. */
  feasible: boolean;
  /** Bu örgü ve iplikle ulaşılabilen en büyük çekme (%). */
  maxShrinkPct: number;
  /** Tezgah ve mamul toplam genişliği. */
  loomWidth: number;
  width: number;
}

/** Su doldurma: açığı 1/k oranında dağıt, kapasitesi dolanı sabitle, kalanı yeniden dağıt. */
export function distributeShrink(input: SpringInput): SpringResult {
  const { loomGaps, minGaps, stiffness, shrink } = input;
  const n = loomGaps.length;
  let W0 = 0;
  let capTotal = 0;
  const cap = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    W0 += loomGaps[k];
    cap[k] = Math.max(0, loomGaps[k] - minGaps[k]);
    capTotal += cap[k];
  }
  const delta = W0 * shrink;
  const take = new Float64Array(n);
  const feasible = capTotal >= delta - 1e-12 * Math.max(1, W0);
  if (!feasible) {
    for (let k = 0; k < n; k++) take[k] = cap[k];
  } else if (delta > 0) {
    const active = new Uint8Array(n);
    for (let k = 0; k < n; k++) active[k] = cap[k] > 0 ? 1 : 0;
    let rem = delta;
    for (let iter = 0; iter <= n && rem > 1e-15; iter++) {
      let S = 0;
      for (let k = 0; k < n; k++) if (active[k]) S += 1 / stiffness[k];
      if (S === 0) break;
      let clamped = false;
      for (let k = 0; k < n; k++) {
        if (!active[k]) continue;
        const alloc = (rem * (1 / stiffness[k])) / S;
        if (take[k] + alloc >= cap[k]) {
          clamped = true;
        }
      }
      if (!clamped) {
        for (let k = 0; k < n; k++) if (active[k]) take[k] += (rem * (1 / stiffness[k])) / S;
        rem = 0;
        break;
      }
      // Kapasitesini aşanları sabitle, kalanı bir sonraki turda dağıt
      for (let k = 0; k < n; k++) {
        if (!active[k]) continue;
        const alloc = (rem * (1 / stiffness[k])) / S;
        if (take[k] + alloc >= cap[k]) {
          rem -= cap[k] - take[k];
          take[k] = cap[k];
          active[k] = 0;
        }
      }
    }
  }
  const gaps = new Float64Array(n);
  let W = 0;
  for (let k = 0; k < n; k++) {
    gaps[k] = loomGaps[k] - take[k];
    W += gaps[k];
  }
  return { gaps, feasible, maxShrinkPct: (100 * capTotal) / W0, loomWidth: W0, width: W };
}

export interface AxisPositions {
  /** Tezgah konumları. */
  loom: PositionGenerator;
  /** Mamul konumları (çekme dağılımı sonrası). */
  finished: PositionGenerator;
  /** Periyot (iplik sayısı) ve periyot verisi. */
  period: number;
  binding: Float64Array;
  loomGaps: Float64Array;
  gaps: Float64Array;
  minGaps: Float64Array;
  radii: Float64Array;
  feasible: boolean;
  maxShrinkPct: number;
  /** Tezgah aralığı 0.55·(r+r)'nin altında olan (tarak zorlaması) aralık var mı. */
  loomJammed: boolean;
  /** Bu eksende çekme sıfır mı (o zaman finished === loom). */
  identity: boolean;
}

export interface FabricPositions {
  warp: AxisPositions;
  weft: AxisPositions;
  /** Tarak varsa tezgah çözgü konum üreticisi (diş geometrisiyle). */
  reed?: ReedPositionGenerator;
  /** Tarak varsa türetilen tezgah çözgü sıklığı. */
  reedDensity?: number;
  reedOverfullDents: number;
  warnings: string[];
}

function axisPositions(
  spec: FabricSpec,
  axis: 'warp' | 'weft',
  loomGen: PositionGenerator,
  loomPeriod: number,
  shrinkPct: number,
): AxisPositions {
  const M = spec.weave;
  const relax = { ...DEFAULT_RELAX, ...(spec.relax ?? {}) };
  const own = axis === 'warp' ? spec.warpSlots : spec.weftSlots;
  const ownSeq = axis === 'warp' ? spec.warpSequence : spec.weftSequence;
  const cross = axis === 'warp' ? spec.weftSlots : spec.warpSlots;
  const crossSeq = axis === 'warp' ? spec.weftSequence : spec.warpSequence;
  const ownT = slotTable(own);
  const crossT = slotTable(cross);
  const repeat = axis === 'warp' ? M[0].length : M.length;
  const crossRepeat = axis === 'warp' ? M.length : M[0].length;

  let P = lcm(lcm(repeat, Math.max(1, ownSeq.length)), loomPeriod);
  if (P > MAX_PERIOD) P = Math.max(repeat, Math.min(MAX_PERIOD, P));
  const crossPeriod = Math.min(lcm(crossRepeat, Math.max(1, crossSeq.length)), MAX_PERIOD);
  const crossD = (j: number) => crossT.diameter[slotOf(crossSeq, j, cross.length)];

  const binding = axis === 'warp' ? warpGapBinding(M) : weftGapBinding(M);
  const crossTermByCol = new Float64Array(repeat);
  for (let k = 0; k < repeat; k++) crossTermByCol[k] = crossWeightedGap(M, axis, k, crossD, crossPeriod);

  const centers = loomGen.centers(0, P + 1);
  const radii = new Float64Array(P + 1);
  for (let g = 0; g <= P; g++) radii[g] = ownT.diameter[slotOf(ownSeq, g, own.length)] / 2;
  const loomGaps = new Float64Array(P);
  const minGaps = new Float64Array(P);
  const stiffness = new Float64Array(P);
  const w = new Float64Array(P);
  let loomJammed = false;
  for (let k = 0; k < P; k++) {
    loomGaps[k] = centers[k + 1] - centers[k];
    const col = k % repeat;
    w[k] = binding[col];
    minGaps[k] = relax.c * (radii[k] + radii[k + 1]) + crossTermByCol[col];
    stiffness[k] = 1 + (relax.rho - 1) * w[k];
    if (loomGaps[k] < MIN_SQUEEZE * (radii[k] + radii[k + 1])) loomJammed = true;
  }
  const shrink = shrinkPct / 100;
  const res = distributeShrink({ loomGaps, minGaps, stiffness, shrink });
  const identity = shrink === 0;
  let finished: PositionGenerator = loomGen;
  if (!identity) {
    // Mamul tablo: 0. iplik tezgah konumunun ölçeklenmiş hali, sonra aralıklar birikimli
    const offsets = new Float64Array(P);
    offsets[0] = centers[0] * (res.width / res.loomWidth);
    for (let k = 1; k < P; k++) offsets[k] = offsets[k - 1] + res.gaps[k - 1];
    finished = new PeriodicPositionGenerator(offsets, res.width);
  }
  return {
    loom: loomGen,
    finished,
    period: P,
    binding: w,
    loomGaps,
    gaps: res.gaps,
    minGaps,
    radii,
    feasible: res.feasible,
    maxShrinkPct: res.maxShrinkPct,
    loomJammed,
    identity,
  };
}

/** Spec'ten tezgah ve mamul iplik konumlarını üretir (tarak + yay modeli). */
export function buildFabricPositions(spec: FabricSpec): FabricPositions {
  const warnings: string[] = [];
  let warpLoom: PositionGenerator = new UniformPositionGenerator(spec.warpDensityLoom);
  let warpLoomPeriod = 1;
  let reedDensity: number | undefined;
  let overfull = 0;
  let reed: ReedPositionGenerator | undefined;
  if (spec.reed && spec.reed.dentingReport.some((n) => n > 0)) {
    const wt = slotTable(spec.warpSlots);
    reed = new ReedPositionGenerator(
      spec.reed,
      (g) => wt.diameter[slotOf(spec.warpSequence, g, spec.warpSlots.length)],
      Math.max(1, spec.warpSequence.length),
    );
    warpLoom = reed;
    warpLoomPeriod = reed.period;
    reedDensity = reed.derivedDensity;
    overfull = reed.overfull.length;
    for (const o of reed.overfull) {
      warnings.push(
        `${o.dent + 1}. dişe ${o.ends} tel sığmıyor (Σ çap ${o.sumDiameterMm.toFixed(2)} mm, açıklık ${o.openingMm.toFixed(2)} mm).`,
      );
    }
  }
  const weftLoom = new UniformPositionGenerator(spec.weftDensityLoom);
  // Çözgü konumlarını en daraltan atkı çekmesi, atkı konumlarını boy kısaltan çözgü çekmesidir.
  const warp = axisPositions(spec, 'warp', warpLoom, warpLoomPeriod, spec.weftShrinkPct);
  const weft = axisPositions(spec, 'weft', weftLoom, 1, spec.warpShrinkPct);
  return { warp, weft, reed, reedDensity, reedOverfullDents: overfull, warnings };
}

/**
 * Tezgah koordinatındaki x'i (mm) aynı ipliklerin mamuldeki konumuna eşler: x'i çevreleyen iki
 * tezgah iplik merkezi arasında doğrusal enterpolasyon ("Aynı iplikler" karşılaştırması için).
 */
export function mapLoomToFinished(ax: AxisPositions, x: number): number {
  if (ax.identity) return x;
  const loom = ax.loom;
  let g = Math.floor(x / loom.meanPitchMm());
  let c = loom.centers(g, 2);
  while (c[0] > x) {
    g--;
    c = loom.centers(g, 2);
  }
  while (c[1] <= x) {
    g++;
    c = loom.centers(g, 2);
  }
  const t = (x - c[0]) / (c[1] - c[0]);
  const f = ax.finished.centers(g, 2);
  return f[0] + t * (f[1] - f[0]);
}
