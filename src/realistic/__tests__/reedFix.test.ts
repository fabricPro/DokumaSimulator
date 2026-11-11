import { describe, expect, it } from 'vitest';
import { fabricInputFromSpec } from '../adapters/fromSpec';
import { threadTable } from '../pack';
import { tileFor } from '../tile';
import { geometryAt, geometryParamsFromInput } from '../geometry';
import { pitchMm } from '../scale';
import { buildFabricPositions } from '../../render-engine/physical/shrinkDistribution';
import { threadLayout } from '../../render-engine/physical/warpLayout';
import { simulatePhysical } from '../../render-engine/physical/simulate';
import { constantPhysicalRandom } from '../../render-engine/physical/random';
import { mockLeno3 } from '../../presets/weaves';
import type { FabricSpec } from '../../render-engine/types';

/** Tekrar üretme vakası: 300 den / 300 den, 6×6 yalancı lino, tarak 12 diş/cm 3-0-0, atkı 15/cm, çekme %6 / %10. */
function repro(report: number[] | null, over: Partial<FabricSpec> = {}): FabricSpec {
  return {
    version: 2,
    weave: mockLeno3(),
    warpSlots: [{ name: 'A', count: 300, system: 'Denier', color: '#e8e2d0', twist: 'S' }],
    weftSlots: [{ name: 'A', count: 300, system: 'Denier', color: '#1f2f5a', twist: 'S' }],
    warpSequence: [0],
    weftSequence: [0],
    warpDensityLoom: 12,
    weftDensityLoom: 15,
    warpShrinkPct: 6,
    weftShrinkPct: 10,
    warpCrimpShare: 0.4,
    ...(report ? { reed: { reedNumber: 12, dentingReport: report } } : {}),
    ...over,
  } as FabricSpec;
}

const REPORTS: Array<number[] | null> = [[3, 0, 0], [4, 0], [3, 3, 0], [2, 2, 3, 0], null];

describe('tarak kayması (Durak 1)', () => {
  for (const rep of REPORTS) {
    for (const which of ['loom', 'finished'] as const) {
      const name = `${rep ? rep.join('-') : 'tarak yok'} · ${which}`;
      it(`hiçbir tel dişinin dışına çıkmaz (düzensizlik ×3 + yol sapması) — ${name}`, () => {
        const spec = repro(rep);
        const input = fabricInputFromSpec(spec, undefined, { densities: which });
        const tile = tileFor(input);
        const irr = 3;
        const th = threadTable(input, tile.threads, irr);
        const p = pitchMm(input.density.warpPerCm);
        const lay = threadLayout(spec, which, buildFabricPositions(spec), 1);
        const P = lay.warp.period;
        expect(tile.threads[0] % P).toBe(0);
        for (let k = 0; k < tile.threads[0]; k++) {
          const o = k * 4;
          const center = (k + 0.5) * p + th.data[o + 1];
          // shader wobV2 (çözgü): 0.0433·çarpan·aralık·(|t₇| + |t₈|)
          const wob = 0.0433 * irr * p * (Math.abs(th.data[(th.width + k) * 4 + 2]) + Math.abs(th.data[(th.width + k) * 4 + 3]));
          const q = Math.floor(k / P);
          const kk = k - q * P;
          const ref = q * lay.warp.periodMm + lay.warp.centers[kk];
          if (lay.warp.wallL && lay.warp.wallR) {
            expect(center - wob).toBeGreaterThanOrEqual(ref - lay.warp.wallL[kk] - 1e-9);
            expect(center + wob).toBeLessThanOrEqual(ref + lay.warp.wallR[kk] + 1e-9);
          }
          // Grup içinde sıra korunur: komşusunun yerine geçmez
          if (k > 0) {
            const prev = (k - 0.5) * p + th.data[o - 4 + 1];
            expect(center).toBeGreaterThan(prev);
          }
        }
      });
      it(`klasik ve gerçekçi konum tablosu birebir aynı — ${name}`, () => {
        const spec = repro(rep);
        const pos = buildFabricPositions(spec);
        const input = fabricInputFromSpec(spec, undefined, { densities: which });
        for (const [ax, gen] of [
          ['warp', pos.warp[which]],
          ['weft', pos.weft[which]],
        ] as const) {
          const t = input.positions![ax]!;
          const ref = gen.centers(1, t.centersMm.length);
          for (let k = 0; k < ref.length; k++) expect(t.centersMm[k]).toBeCloseTo(ref[k], 5);
          expect(t.periodMm).toBeCloseTo(gen.centers(1 + ref.length, 1)[0] - ref[0], 6);
        }
        // Düzensizlik 0: gerçekçi tel i'nin merkezi klasik tel i + 1'in hücresi içinde (paketleme yalnız hücre içinde iter)
        const tile = tileFor(input);
        const th = threadTable(input, tile.threads, 0);
        const p = pitchMm(input.density.warpPerCm);
        const lay = threadLayout(spec, which, pos, 1);
        for (let k = 0; k < lay.warp.period; k++) {
          const c = (k + 0.5) * p + th.data[k * 4 + 1];
          const r = lay.warp.centers[k];
          if (lay.warp.wallL) {
            expect(c).toBeGreaterThanOrEqual(r - lay.warp.wallL[k] - 1e-9);
            expect(c).toBeLessThanOrEqual(r + lay.warp.wallR![k] + 1e-9);
          } else expect(c).toBeCloseTo(r, 5);
        }
      });
    }
  }

  it('aynı tel aynı bağlantıyla: kesişim merkezlerinde gerçekçi üst iplik = klasik örgü (g = i + 1)', () => {
    for (const rep of REPORTS) {
      const spec = repro(rep);
      const input = fabricInputFromSpec(spec);
      const g = geometryParamsFromInput(input, 1, 0, 'v2', 1);
      const W = spec.weave[0].length;
      const H = spec.weave.length;
      let agree = 0;
      let n = 0;
      for (let i = 0; i < 12; i++) {
        for (let j = 0; j < 12; j++) {
          const s = geometryAt(g.warpCenter(i), g.weftCenter(j), g);
          const classicUp = spec.weave[(j + 1) % H][(i + 1) % W];
          if (s.axis === 0) continue;
          n++;
          if ((s.axis === 1) === classicUp && s.index === (s.axis === 1 ? i : j)) agree++;
        }
      }
      expect(agree / n).toBeGreaterThanOrEqual(0.995);
    }
  });

  it('klasik render ile aynı mm konumunda aynı tel: debug.topId (g) ↔ gerçekçi indeks + 1', () => {
    const spec = repro([3, 0, 0]);
    // simulatePhysical her zaman mamul konumlarını çizer
    const input = fabricInputFromSpec(spec, undefined, { densities: 'finished' });
    const g = geometryParamsFromInput(input, 1, 0, 'v2', 1);
    const ppm = 40;
    const view = { x0Mm: 0, y0Mm: 0, widthMm: 6, heightMm: 3, pxPerMm: ppm };
    const res = simulatePhysical(spec, view, { random: constantPhysicalRandom(), scaleBar: false, debug: { collect: true, geometryOnly: true } });
    const { width: Wp, height: Hp } = res.image;
    let agree = 0;
    let n = 0;
    // Yalnız tel merkezlerinde (kesit ortası) karşılaştır: kesit profilleri iki modelde farklı
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 4; j++) {
        const X = g.warpCenter(i);
        const Y = g.weftCenter(j);
        const xx = Math.round(X * ppm);
        const yy = Hp - 1 - Math.round(Y * ppm);
        if (xx < 0 || xx >= Wp || yy < 0 || yy >= Hp) continue;
        const id = res.debug!.topId[yy * Wp + xx];
        const s = geometryAt(X, Y, g);
        if (id === 0 || s.axis === 0) continue;
        n++;
        const realId = s.axis === 1 ? s.index + 2 : -(s.index + 2); // klasik: +(g+1) / −(g+1), g = i + 1
        if (realId === id) agree++;
      }
    }
    expect(n).toBeGreaterThan(10);
    expect(agree / n).toBeGreaterThanOrEqual(0.95);
  });
});
