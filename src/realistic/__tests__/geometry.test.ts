import { describe, expect, it } from 'vitest';
import { ellipseAxes, flattening, geometryAt, geometryParamsFromInput } from '../geometry';
import { inputFromRows, expandBandedFixture, type BandedFixture } from '../fixtures';
import { simulatePhysical } from '../../render-engine/physical/simulate';
import { constantPhysicalRandom } from '../../render-engine/physical/random';
import { plain, satin5, twill22, twill31, brokenTwill13 } from '../../presets/weaves';
import type { FabricSpec } from '../../render-engine/types';
import type { FabricInput } from '../types';
import banded from '../../../fixtures/banded-warp-sample.json';

describe('kesit basıklığı (elips)', () => {
  it('seyrekte daire (k = 1), doluluk 0.6 üstünde yayılır, en fazla 2.2', () => {
    expect(flattening(0.2, 0.5)).toBe(1); // d/p = 0.4
    expect(flattening(0.3, 0.375)).toBeCloseTo(1 + 1.2 * (0.8 - 0.6), 12);
    expect(flattening(1, 0.5)).toBe(2.2);
    expect(flattening(0.3, 0.375, 0)).toBe(1); // tutarlılık modu
  });
  it('alan korunur: a·b = r²; k > 1 iken a > r > b', () => {
    const { a, b } = ellipseAxes(0.1, 1.6);
    expect(a * b).toBeCloseTo(0.01, 12);
    expect(a).toBeGreaterThan(0.1);
    expect(b).toBeLessThan(0.1);
  });
});

describe('geometri ikizi', () => {
  const inp = inputFromRows(twill31(), '#ffffff', '#000000', { warpPerCm: 20, weftPerCm: 20 });
  const g = geometryParamsFromInput(inp, 0, 0);
  it('uzun flottede krepaj düz, bağlantıda dalgalı', () => {
    // 3/1 dimi: çözgü 1 atkı 0,1,2'de üstte (3 atkılık flotte) → bu aralıkta dalga sabit, eğim 0
    const p = g.pitchWeft;
    const x = 1.5 * g.pitchWarp; // çözgü 1 merkezi
    const a = geometryAt(x, 0.6 * p, g);
    const b = geometryAt(x, 1.4 * p, g);
    expect(a.axis).toBe(1);
    expect(a.index).toBe(1);
    expect(a.height).toBeCloseTo(b.height, 10);
    expect(Math.abs(a.grad[1])).toBeLessThan(1e-9);
    // Flottenin sonunda (atkı 2 → 3 geçişi) iplik iner
    const c = geometryAt(x, 3.0 * p, g);
    expect(c.height).toBeLessThan(a.height);
  });
  it('boşlukta zemin ya da alttaki iplik görünür', () => {
    const sparse = geometryParamsFromInput(inputFromRows(plain(), '#ffffff', '#000000', { warpPerCm: 10, weftPerCm: 10 }), 0, 0);
    // iki iplik arasında (x = 1·p, y = 1·p köşe) kimse kaplamaz → zemin
    const s = geometryAt(1.0, 1.0, sparse);
    expect(s.axis).toBe(0);
    expect(s.height).toBe(sparse.bgHeight);
  });
  it('kimlik matrise sadık: hücre merkezinde üstteki iplik matristen gelir', () => {
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        const s = geometryAt((i + 0.5) * g.pitchWarp, (j + 0.5) * g.pitchWeft, g);
        expect(s.axis === 1).toBe(g.warpUp(i, j));
      }
    }
  });
  it('orijinin solu / altı: negatif indekslerde de sistem ve yükseklik bir rapor ötesiyle aynı', () => {
    // Düzensizlik kapalıyken geometri örgü raporuyla periyodik. Eski +(i+1)/−(j+1) kimliği burada
    // belirsizdi (çözgü −1 → 0 = "zemin", atkı −2 → +1 = "çözgü 0") ve üstteki iplik yanlış seçiliyordu.
    for (const rows of [plain(), twill22(), satin5(), brokenTwill13()]) {
      const ginp = inputFromRows(rows, '#ffffff', '#000000', { warpPerCm: 27, weftPerCm: 23 });
      const gg = geometryParamsFromInput(ginp, 1, 0);
      const nx = ginp.weave.warps;
      const ny = ginp.weave.wefts;
      const PX = nx * gg.pitchWarp;
      const PY = ny * gg.pitchWeft;
      let checked = 0;
      for (let y = 0; y < 40; y++) {
        for (let x = 0; x < 40; x++) {
          const X = ((x + 0.37) / 40) * 2 * PX - 2 * PX; // [−2PX, 0)
          const Y = ((y + 0.61) / 40) * 2 * PY - 2 * PY;
          const neg = geometryAt(X, Y, gg);
          const pos = geometryAt(X + 4 * PX, Y + 4 * PY, gg);
          expect(neg.axis).toBe(pos.axis);
          if (neg.axis === 1) expect(neg.index + 4 * nx).toBe(pos.index);
          if (neg.axis === 2) expect(neg.index + 4 * ny).toBe(pos.index);
          expect(neg.height).toBeCloseTo(pos.height, 9);
          checked++;
        }
      }
      expect(checked).toBe(1600);
    }
  });
  it('negatif indekste matrise sadık (hücre merkezi)', () => {
    for (let i = -8; i < 0; i++) {
      for (let j = -8; j < 0; j++) {
        const s = geometryAt((i + 0.5) * g.pitchWarp, (j + 0.5) * g.pitchWeft, g);
        expect(s.axis === 1).toBe(g.warpUp(i, j));
        expect(s.index).toBe(s.axis === 1 ? i : j);
      }
    }
  });
});

/** Karşılaştırma için tek iplikli FabricSpec (mevcut CPU heightfield girdisi). */
function specForCompare(inp: FabricInput): FabricSpec {
  const weave: boolean[][] = [];
  for (let r = 0; r < inp.weave.wefts; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < inp.weave.warps; c++) row.push(inp.weave.data[r * inp.weave.warps + c] === 1);
    weave.push(row);
  }
  const yt = (k: number) => inp.yarnTypes[k];
  const slot = (k: number, name: 'A') => ({ name, count: yt(k).count, system: yt(k).unit, color: '#888888', twist: yt(k).twist });
  return {
    version: 2,
    weave,
    warpSlots: [slot(inp.warp[0].yarnType, 'A')],
    weftSlots: [slot(inp.weft[0].yarnType, 'A')],
    warpSequence: [0],
    weftSequence: [0],
    warpDensityLoom: inp.density.warpPerCm,
    weftDensityLoom: inp.density.weftPerCm,
    warpShrinkPct: 0,
    weftShrinkPct: 0,
    warpCrimpShare: 0.4,
  };
}

describe('mevcut CPU heightfield ile tutarlılık (gürültüsüz, k = 1)', () => {
  const cases: Array<[string, FabricInput]> = [
    ['bez ayağı', inputFromRows(plain(), '#ffffff', '#000000')],
    ['2/2 dimi', inputFromRows(twill22(), '#ffffff', '#000000')],
    ['3/1 dimi', inputFromRows(twill31(), '#ffffff', '#000000')],
    ['5li saten', inputFromRows(satin5(), '#ffffff', '#000000')],
    ['1/3 kırık dimi', inputFromRows(brokenTwill13(), '#ffffff', '#000000')],
    ['bantlı çözgü', expandBandedFixture(banded as BandedFixture)],
  ];
  for (const [name, inp] of cases) {
    it(name, () => {
      const spec = specForCompare(inp);
      const ppm = 40;
      const N = 160;
      const cpu = simulatePhysical(
        spec,
        { x0Mm: 0, y0Mm: 0, widthMm: N / ppm, heightMm: N / ppm, pxPerMm: ppm },
        { random: constantPhysicalRandom(), scaleBar: false, debug: { geometryOnly: true, collect: true } },
      ).debug!;
      const g = geometryParamsFromInput(inp, 0, 0);
      // CPU iplik g'nin merkezi (g − 0.5)·p, gerçekçi modda i'nin (i + 0.5)·p: aynı iplikler için
      // gerçekçi pencere bir aralık sağa/yukarı kaydırılır (i = g).
      const shiftX = g.pitchWarp;
      const shiftY = g.pitchWeft;
      let same = 0;
      let maxDh = 0;
      const r = Math.min(g.warpRadius(0), g.weftRadius(0));
      for (let yy = 0; yy < N; yy++) {
        for (let xx = 0; xx < N; xx++) {
          const X = Math.fround(xx / ppm);
          const Y = Math.fround((N - 1 - yy) / ppm);
          const s = geometryAt(X + shiftX, Y + shiftY, g);
          const o = yy * N + xx;
          const cpuId = cpu.topId[o];
          if (cpuId === s.id) {
            same++;
            if (s.id !== 0) maxDh = Math.max(maxDh, Math.abs(cpu.height[o] - s.height));
          }
        }
      }
      expect(same / (N * N)).toBeGreaterThan(0.995);
      expect(maxDh).toBeLessThan(0.02 * r);
    });
  }
});
