import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFabricPositions } from '../../physical/shrinkDistribution';
import { transposeWeave, weftGapBinding, warpGapBinding } from '../../physical/interlacing';
import { structureMetrics } from '../../physical/metrics';
import { simulatePhysical } from '../../physical/simulate';
import { constantPhysicalRandom } from '../../physical/random';
import { deriveWeftReport, parseWeftReport, WeftReportPositionGenerator } from '../weftReport';
import { hopsack, mockLeno3, plain, twill22, twill31 } from '../../../presets/weaves';
import { parseFabricJson, serializeFabricJson } from '../../../importers/fabricJson';
import type { FabricSpec } from '../../types';

// Kullanıcının 6×6 örgüsü (samples/input/kullanici-6x6.json); yoksa test açıkça başarısız olur.
const USER = parseFabricJson(readFileSync(join(__dirname, '../../../../samples/input/kullanici-6x6.json'), 'utf-8')).spec;

function spec(weave: boolean[][], over: Partial<FabricSpec> = {}): FabricSpec {
  return {
    version: 2,
    weave,
    warpSlots: [{ name: 'A', count: 300, system: 'Denier', color: '#ddd', twist: 'S' }],
    weftSlots: [{ name: 'A', count: 300, system: 'Denier', color: '#444', twist: 'S' }],
    warpSequence: [0],
    weftSequence: [0],
    warpDensityLoom: 12,
    weftDensityLoom: 12,
    warpShrinkPct: 0,
    weftShrinkPct: 0,
    warpCrimpShare: 0.4,
    ...over,
  };
}

/** Çözgü ↔ atkı yer değiştirmiş spec (örgü transpoz, slotlar/diziler/sıklıklar/çekmeler takas). */
function swapAxes(s: FabricSpec): FabricSpec {
  return {
    version: 2,
    weave: transposeWeave(s.weave),
    warpSlots: s.weftSlots,
    weftSlots: s.warpSlots,
    warpSequence: s.weftSequence,
    weftSequence: s.warpSequence,
    warpDensityLoom: s.weftDensityLoom,
    weftDensityLoom: s.warpDensityLoom,
    warpShrinkPct: s.weftShrinkPct,
    weftShrinkPct: s.warpShrinkPct,
    warpCrimpShare: 1 - s.warpCrimpShare,
    ...(s.relax ? { relax: s.relax } : {}),
  };
}

describe('simetri: çözgü ve atkı aynı fizik', () => {
  const user = { ...USER, reed: undefined } as FabricSpec;
  delete (user as Partial<FabricSpec>).reed;
  const cases: Array<[string, FabricSpec]> = [
    ['bezayağı', spec(plain(), { warpDensityLoom: 14, weftDensityLoom: 11 })],
    ['3/1 dimi', spec(twill31(), { warpDensityLoom: 16, weftDensityLoom: 12 })],
    ['panama', spec(hopsack())],
    ['3×3 yalancı lino', spec(mockLeno3(), { warpDensityLoom: 13, weftDensityLoom: 10 })],
    ['kullanıcı 6×6 (karışık kalın/ince)', user],
    [
      'karışık kalın/ince atkı',
      spec(mockLeno3(), {
        weftSlots: [
          { name: 'A', count: 600, system: 'Denier', color: '#444', twist: 'S' },
          { name: 'B', count: 100, system: 'Denier', color: '#4cf', twist: 'S' },
        ],
        weftSequence: [0, 1, 1],
      }),
    ],
  ];
  for (const [name, base] of cases) {
    for (const [sw, sf] of [
      [0, 0],
      [15, 0],
      [30, 10],
      [8, 20],
    ]) {
      it(`${name}, çözgü çekmesi %${sw}, atkı çekmesi %${sf}`, () => {
        const a = { ...base, warpShrinkPct: sw, weftShrinkPct: sf };
        const b = swapAxes(a);
        const pa = buildFabricPositions(a);
        const pb = buildFabricPositions(b);
        // Çözgü konumları ↔ atkı konumları birebir (1e-6 mm)
        const ca = pa.warp.finished.centers(-12, 60);
        const cb = pb.weft.finished.centers(-12, 60);
        const fa = pa.weft.finished.centers(-12, 60);
        const fb = pb.warp.finished.centers(-12, 60);
        for (let k = 0; k < 60; k++) {
          expect(Math.abs(ca[k] - cb[k])).toBeLessThan(1e-6);
          expect(Math.abs(fa[k] - fb[k])).toBeLessThan(1e-6);
        }
        expect(Array.from(pa.weft.binding)).toEqual(Array.from(pb.warp.binding));
        expect(pa.weft.feasible).toBe(pb.warp.feasible);
      });
    }
  }
});

describe('değişmezler (atkı yönü)', () => {
  const gaps = (M: boolean[][], sw: number) => Array.from(buildFabricPositions(spec(M, { warpShrinkPct: sw })).weft.gaps);
  it('bezayağı ve 2/2 dimide atkılar her çözgü çekmesinde eşit aralıklı', () => {
    for (const M of [plain(), twill22()]) {
      for (const sw of [0, 15, 30]) {
        const g = gaps(M, sw);
        for (const x of g) expect(x).toBeCloseTo(g[0], 10);
      }
    }
  });
  it('panamada atkılar ikili gruplaşır', () => {
    const s = spec(hopsack(), { warpShrinkPct: 30 });
    const g = gaps(hopsack(), 30);
    expect(g[0]).toBeLessThan(g[1]);
    expect(structureMetrics(s).weft.groupingRatio).toBeGreaterThan(1.5);
  });
  it('3×3 yalancı linoda atkılar üçlü gruplaşır, gözenek iki yönde açılır', () => {
    const s = spec(mockLeno3(), { warpShrinkPct: 30, weftShrinkPct: 30 });
    const p = buildFabricPositions(s);
    const g = Array.from(p.weft.gaps);
    expect(g[0]).toBeCloseTo(g[1], 10);
    expect(g[2]).toBeGreaterThan(g[0]);
    const st = structureMetrics(s, p);
    expect(st.weft.groupingRatio).toBeGreaterThan(1.2);
    expect(st.warp.groupingRatio).toBeGreaterThan(1.2);
    const ref = structureMetrics(spec(plain(), { warpShrinkPct: 30, weftShrinkPct: 30 }));
    expect(st.poreMm[0]).toBeGreaterThan(ref.poreMm[0]);
    expect(st.poreMm[1]).toBeGreaterThan(ref.poreMm[1]);
  });
  it('kullanıcı 6×6: w_atkı = w_çözgü = [⅔, ⅔, 1, ⅔, ⅔, 1]', () => {
    const w = Array.from(weftGapBinding(USER.weave));
    expect(w.map((x) => +x.toFixed(4))).toEqual([0.6667, 0.6667, 1, 0.6667, 0.6667, 1]);
    expect(Array.from(warpGapBinding(USER.weave))).toEqual(w);
  });
  it('toplam boy hedefe eşit (±%0.1) ve hiçbir atkı aralığı m_j altında değil', () => {
    for (const M of [hopsack(), mockLeno3(), USER.weave]) {
      for (const sw of [10, 30]) {
        const p = buildFabricPositions(spec(M, { warpShrinkPct: sw }));
        const W0 = Array.from(p.weft.loomGaps).reduce((a, b) => a + b, 0);
        const W = Array.from(p.weft.gaps).reduce((a, b) => a + b, 0);
        expect(Math.abs(W / W0 - (1 - sw / 100))).toBeLessThan(0.001);
        p.weft.gaps.forEach((g, k) => expect(g).toBeGreaterThanOrEqual(p.weft.minGaps[k] - 1e-12));
      }
    }
  });
  it('ulaşılamaz çözgü çekmesinde atkı uyarısı ve maksimum çekme', () => {
    const s = spec(plain(), { warpShrinkPct: 70 });
    const st = structureMetrics(s);
    expect(st.feasible).toBe(false);
    expect(st.warnings.join(' ')).toMatch(/Çözgü çekmesi %70 \(boy, atkı aralıkları\).*mümkün değil/);
    expect(st.maxWarpShrinkPct).toBeGreaterThan(0);
    expect(st.maxWarpShrinkPct).toBeLessThan(70);
  });
});

describe('atkı sıklık raporu', () => {
  it('"1-1-1-3": tezgahta 4. atkıdan sonra 3 adım', () => {
    const r = parseWeftReport('1-1-1-3');
    expect(r.ok && r.report).toEqual([1, 1, 1, 3]);
    const g = new WeftReportPositionGenerator(12, [1, 1, 1, 3]);
    const p0 = 10 / 12;
    const c = g.centers(0, 9);
    const gaps = Array.from(c.slice(1), (x, i) => x - c[i]);
    expect(gaps.map((x) => +(x / p0).toFixed(9))).toEqual([1, 1, 1, 3, 1, 1, 1, 3]);
    expect(c[0]).toBeCloseTo(-0.5 * p0, 12); // düzgün üreticiyle aynı başlangıç
  });
  it('çekmede w\'ye göre daralır; ortalama sıklık ve sözdizimi', () => {
    const s = spec(hopsack(), { weftDensityReport: [1, 1, 1, 3], warpShrinkPct: 20 });
    const p = buildFabricPositions(s);
    const W0 = Array.from(p.weft.loomGaps).reduce((a, b) => a + b, 0);
    const W = Array.from(p.weft.gaps).reduce((a, b) => a + b, 0);
    expect(W / W0).toBeCloseTo(0.8, 6);
    expect(p.weftLoomDensity).toBeCloseTo((12 * 4) / 6, 10);
    expect(deriveWeftReport(12, [1, 1, 1, 3]).meanDensity).toBeCloseTo(8, 10);
    const e = parseWeftReport('1-0-1');
    expect(e.ok).toBe(false);
    if (!e.ok) expect(e.error).toMatch(/en az 1/);
    expect(parseWeftReport('1x3, 2').ok && (parseWeftReport('1x3, 2') as { report: number[] }).report).toEqual([1, 1, 1, 2]);
  });
  it('JSON gidiş-dönüş; boş rapor = eşit adım', () => {
    const s = spec(plain(), { weftDensityReport: [1, 1, 1, 3] });
    expect(parseFabricJson(serializeFabricJson(s)).spec).toEqual(s);
    expect(buildFabricPositions(spec(plain())).weftLoomDensity).toBeUndefined();
  });
});

describe('render aktarımı', () => {
  it('mamul görüntüdeki atkı merkezleri yay modeliyle 1.5 px içinde (panama, çözgü çekmesi %30)', () => {
    const s = spec(hopsack(), {
      warpShrinkPct: 30,
      warpSlots: [{ name: 'A', count: 300, system: 'Denier', color: '#ffffff', twist: 'S' }],
      weftSlots: [{ name: 'A', count: 300, system: 'Denier', color: '#ff0000', twist: 'S' }],
    });
    const pos = buildFabricPositions(s);
    const ppm = 50;
    const res = simulatePhysical(s, { x0Mm: 0, y0Mm: 0, widthMm: 4, heightMm: 4, pxPerMm: ppm }, { random: constantPhysicalRandom(), scaleBar: false, positions: pos });
    const { width: W, height: H, data } = res.image;
    const red: number[] = [];
    for (let y = 0; y < H; y++) {
      let n = 0;
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        if (data[o] > 60 && data[o] > data[o + 1] * 1.6) n++;
      }
      red.push(n / W);
    }
    const found: number[] = [];
    let y = 0;
    while (y < H) {
      if (red[y] > 0.25) {
        const s0 = y;
        while (y < H && red[y] > 0.25) y++;
        found.push((H - 1 - (s0 + y - 1) / 2) / ppm);
      } else y++;
    }
    const r = pos.weft.finished.indexRange(0, 4);
    const model = Array.from(pos.weft.finished.centers(r.first, r.count));
    const inner = found.filter((c) => c > 0.2 && c < 3.8);
    expect(inner.length).toBeGreaterThan(4);
    for (const c of inner) {
      const err = Math.min(...model.map((m) => Math.abs(m - c)));
      expect(err * ppm).toBeLessThan(1.5);
    }
  });
});
