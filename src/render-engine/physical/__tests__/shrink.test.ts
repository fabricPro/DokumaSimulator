import { describe, expect, it } from 'vitest';
import { sum, warpGapBinding, weftGapBinding } from '../interlacing';
import { lateralInterlacing } from '../squeeze';
import { buildFabricPositions, distributeShrink, mapLoomToFinished } from '../shrinkDistribution';
import { UniformPositionGenerator } from '../positions';
import { diameterMm, toTex } from '../yarnPhysics';
import { dobbyFancy, hopsack, mockLeno3, plain, satin5, twill22, twill31 } from '../../../presets/weaves';
import type { FabricSpec } from '../../types';

const ALL = { plain: plain(), twill22: twill22(), twill31: twill31(), satin5: satin5(), panama: hopsack(), mockleno: mockLeno3(), dobby: dobbyFancy() };

function spec(weave: boolean[][], over: Partial<FabricSpec> = {}): FabricSpec {
  return {
    version: 2,
    weave,
    warpSlots: [{ name: 'A', count: 300, system: 'Denier', color: '#ddd', twist: 'S' }],
    weftSlots: [{ name: 'A', count: 300, system: 'Denier', color: '#444', twist: 'S' }],
    warpSequence: [0],
    weftSequence: [0],
    warpDensityLoom: 13,
    weftDensityLoom: 13,
    warpShrinkPct: 0,
    weftShrinkPct: 0,
    warpCrimpShare: 0.4,
    ...over,
  };
}

describe('bağlantı oranı w_k', () => {
  it('bezayağı tüm w = 1, 2/2 dimi tüm w = 0.5', () => {
    expect(Array.from(warpGapBinding(plain()))).toEqual([1, 1]);
    expect(Array.from(weftGapBinding(plain()))).toEqual([1, 1]);
    expect(Array.from(warpGapBinding(twill22()))).toEqual([0.5, 0.5, 0.5, 0.5]);
    expect(Array.from(weftGapBinding(twill22()))).toEqual([0.5, 0.5, 0.5, 0.5]);
  });
  it('panama 2/2: çift içinde 0, çiftler arasında 1', () => {
    expect(Array.from(warpGapBinding(hopsack()))).toEqual([0, 1, 0, 1]);
    expect(Array.from(weftGapBinding(hopsack()))).toEqual([0, 1, 0, 1]);
  });
  it('3×3 yalancı lino: grup içinde < 1, grup sınırında = 1', () => {
    const w = Array.from(warpGapBinding(mockLeno3()));
    expect(w[0]).toBeCloseTo(1 / 3, 12);
    expect(w[1]).toBeCloseTo(1 / 3, 12);
    expect(w[2]).toBe(1); // çözgü 3–4
    expect(w[3]).toBeCloseTo(1 / 3, 12);
    expect(w[4]).toBeCloseTo(1 / 3, 12);
    expect(w[5]).toBe(1); // çözgü 6–1
    const f = Array.from(weftGapBinding(mockLeno3()));
    expect(f[2]).toBe(1);
    expect(f[5]).toBe(1);
    expect(f[0]).toBeLessThan(1);
  });
  it('her örgüde Σ w_k = Ashenhurst I', () => {
    for (const [name, M] of Object.entries(ALL)) {
      expect(sum(warpGapBinding(M)), name).toBeCloseTo(lateralInterlacing(M, 'warp').I, 12);
      expect(sum(weftGapBinding(M)), name).toBeCloseTo(lateralInterlacing(M, 'weft').I, 12);
    }
  });
});

describe('yay modeli (su doldurma)', () => {
  const base = { loomGaps: new Float64Array([1, 1, 1, 1]), minGaps: new Float64Array([0.2, 0.2, 0.2, 0.2]) };

  it('toplam genişlik hedefe eşit ve hiçbir aralık m_k altında değil', () => {
    const r = distributeShrink({ ...base, stiffness: new Float64Array([1, 8, 1, 8]), shrink: 0.3 });
    expect(r.feasible).toBe(true);
    expect(Math.abs(r.width - 4 * 0.7) / (4 * 0.7)).toBeLessThan(0.001);
    for (let k = 0; k < 4; k++) expect(r.gaps[k]).toBeGreaterThanOrEqual(0.2 - 1e-12);
    // yumuşak aralıklar önce kapanır
    expect(r.gaps[0]).toBeLessThan(r.gaps[1]);
  });
  it('yumuşak aralık m_k\'ya dayanınca kalan açık sertlere gider', () => {
    const r = distributeShrink({ ...base, stiffness: new Float64Array([1, 8, 1, 8]), shrink: 0.6 });
    expect(r.gaps[0]).toBeCloseTo(0.2, 12);
    expect(r.gaps[2]).toBeCloseTo(0.2, 12);
    expect(r.width).toBeCloseTo(1.6, 10);
    expect(r.gaps[1]).toBeCloseTo(0.6, 10);
  });
  it('ulaşılamaz çekme: aralıklar m_k\'da, uyarı ve doğru maksimum çekme', () => {
    const r = distributeShrink({ ...base, stiffness: new Float64Array([1, 1, 1, 1]), shrink: 0.9 });
    expect(r.feasible).toBe(false);
    for (let k = 0; k < 4; k++) expect(r.gaps[k]).toBeCloseTo(0.2, 12);
    expect(r.maxShrinkPct).toBeCloseTo(80, 10); // (4 − 0.8)/4
  });
  it('%0 çekmede tezgahla aynı', () => {
    const r = distributeShrink({ ...base, stiffness: new Float64Array([1, 8, 1, 8]), shrink: 0 });
    expect(Array.from(r.gaps)).toEqual([1, 1, 1, 1]);
  });
});

describe('çekme dağılımı örgülerde', () => {
  const gapsOf = (M: boolean[][], shrink: number) => buildFabricPositions(spec(M, { weftShrinkPct: shrink, warpShrinkPct: shrink }));

  it('bezayağı ve 2/2 dimi her çekmede eşit aralıklı kalır', () => {
    for (const M of [plain(), twill22()]) {
      for (const s of [0, 8, 15, 25]) {
        const p = gapsOf(M, s);
        for (const ax of [p.warp, p.weft]) {
          const g = Array.from(ax.gaps);
          for (const x of g) expect(x).toBeCloseTo(g[0], 10);
          expect(ax.feasible).toBe(true);
        }
      }
    }
  });
  it('panama ikili gruplaşır (çift içi aralık < çiftler arası)', () => {
    const p = gapsOf(hopsack(), 15);
    expect(p.warp.gaps[0]).toBeLessThan(p.warp.gaps[1]);
    expect(p.weft.gaps[0]).toBeLessThan(p.weft.gaps[1]);
    // ortalama sıklık çekme formülüyle aynı
    const W0 = Array.from(p.warp.loomGaps).reduce((a, b) => a + b, 0);
    const W = Array.from(p.warp.gaps).reduce((a, b) => a + b, 0);
    expect(W / W0).toBeCloseTo(0.85, 6);
  });
  it('yalancı lino: grup sınırı açık kalır', () => {
    const p = gapsOf(mockLeno3(), 15);
    const g = p.warp.gaps;
    expect(g[2]).toBeGreaterThan(g[0]);
    expect(g[5]).toBeGreaterThan(g[4]);
  });
  it('en küçük aralık m_k = c·(r+r) + w·d_karşı', () => {
    const p = gapsOf(hopsack(), 0);
    const d = diameterMm(toTex(300, 'Denier'));
    expect(p.warp.minGaps[0]).toBeCloseTo(0.85 * d, 12); // w = 0
    expect(p.warp.minGaps[1]).toBeCloseTo(0.85 * d + d, 12); // w = 1
  });
  it('aynı iplikler eşlemesi: tezgahta iplik merkezi mamulde aynı ipliğin merkezine gider', () => {
    const p = gapsOf(hopsack(), 15);
    const c = p.warp.loom.centers(5, 1)[0];
    expect(mapLoomToFinished(p.warp, c)).toBeCloseTo(p.warp.finished.centers(5, 1)[0], 10);
  });
});

describe('tarak (yay modeli girdisi)', () => {
  it('tarak yoksa düzgün üretici (bugünkü davranış)', () => {
    const p = buildFabricPositions(spec(plain()));
    expect(p.warp.loom).toBeInstanceOf(UniformPositionGenerator);
    expect(p.reed).toBeUndefined();
  });
  it('tarak varsa tezgah aralıkları taraktan, sıklık uyarısı', () => {
    const p = buildFabricPositions(spec(mockLeno3(), { reed: { reedNumber: 10, dentingReport: [3, 0, 0] } }));
    expect(p.reedDensity).toBeCloseTo(10, 12);
    expect(p.reed).toBeDefined();
    // grup içi aralık < grup arası (boş dişler)
    expect(p.warp.loomGaps[0]).toBeLessThan(p.warp.loomGaps[2]);
  });
});
