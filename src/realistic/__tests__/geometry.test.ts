import { describe, expect, it } from 'vitest';
import { compressionFactor, crossingTable, crossingZ, ellipseAxes, flattening, flatteningV2, geometryAt, geometryParamsFromInput, v2BgHeight, type GeometryParams } from '../geometry';
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

describe('v2 temas tabanlı z (fix-v3)', () => {
  // Elle kurulmuş parametreler: çözgü r_w = 0.1, atkılar sırayla 0.2 (kalın) ve 0.05 (ince); bez ayağı.
  // Aralık 1.2 mm: açık doku (d/p ≤ 0.33) → sıkışma yok, saf temas.
  const P = 1.2;
  const plainUp = (i: number, j: number) => (((i + j) % 2) + 2) % 2 === 0;
  const make = (warpUp: (i: number, j: number) => boolean, weaveSize: [number, number]): GeometryParams => ({
    warpUp,
    warpRadius: () => 0.1,
    weftRadius: (j) => (((j % 2) + 2) % 2 === 0 ? 0.2 : 0.05),
    warpCenter: (i) => (i + 0.5) * P,
    weftCenter: (j) => (j + 0.5) * P,
    pitchWarp: P,
    pitchWeft: P,
    crimpShare: 0.5,
    model: 'v2',
    flattenFactor: 1,
    bgHeight: v2BgHeight(0.2, 0.5),
    weaveSize,
  });

  it('farklı yarıçaplı iki iplik: kesişimde merkezler arası z_üst − z_alt = r_üst + r_alt', () => {
    const g = make(plainUp, [2, 2]);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const z = crossingZ(i, j, g);
        const rf = g.weftRadius(j);
        const up = g.warpUp(i, j);
        expect(up ? z.zw - z.zf : z.zf - z.zw).toBeCloseTo(0.1 + rf, 12);
        expect(up ? z.zw > z.zf : z.zf > z.zw).toBe(true);
      }
    }
    // Kalın atkı çözgüyü daha çok büker: genlik (b_w + b_f)·β
    expect(Math.abs(crossingZ(0, 0, g).zw)).toBeCloseTo(0.5 * 0.3, 12);
    expect(Math.abs(crossingZ(0, 1, g).zw)).toBeCloseTo(0.5 * 0.15, 12);
  });

  it('kalın ve ince atkı: taban geometride kendi yarıçapıyla görünür, zemin altına düşmez', () => {
    const g = make(plainUp, [2, 2]);
    // Atkı 0 (kalın) çözgü 1'in üstünde (i + j tek → atkı üstte), atkı 1 (ince) çözgü 0'ın üstünde
    const thick = geometryAt(1.5 * P, 0.5 * P, g);
    const thin = geometryAt(0.5 * P, 1.5 * P, g);
    expect(thick.axis).toBe(2);
    expect(thin.axis).toBe(2);
    expect(thick.height).toBeCloseTo(crossingZ(1, 0, g).zf + 0.2, 12);
    expect(thin.height).toBeCloseTo(crossingZ(0, 1, g).zf + 0.05, 12);
    // İplik altı her yerde zeminin üstünde
    for (let x = 0; x < 4 * P; x += 0.013) {
      for (let y = 0; y < 4 * P; y += 0.017) {
        const s = geometryAt(x, y, g);
        if (s.axis === 0) continue;
        const r = s.axis === 1 ? 0.1 : g.weftRadius(s.index);
        // kesit altı: z − b·√(1 − v²) = yükseklik − 2·b·√(1 − v²)
        expect(s.height - 2 * r * Math.sqrt(1 - s.v * s.v)).toBeGreaterThan(g.bgHeight);
      }
    }
  });

  it('uzun atlama: flotte boyunca iplik düz kalır, aradaki boşlukta inmez', () => {
    // Çözgü 0, atkı 0..3 üstünde (4'lü flotte), sonra 4..7 altta; kalın / ince atkılar karışık
    const up = (i: number, j: number) => ((((j - (i % 2) * 4) % 8) + 8) % 8) < 4;
    const g = make(up, [2, 8]);
    const zs = [0, 1, 2, 3].map((j) => crossingZ(0, j, g).zw);
    for (const z of zs) expect(z).toBeCloseTo(zs[0], 12);
    // koşudaki en kalın atkıyla: β·(b_w + max b_f)
    expect(zs[0]).toBeCloseTo(0.5 * (0.1 + 0.2), 12);
    const x = 0.5 * P;
    const h0 = geometryAt(x, 0.5 * P, g).height;
    for (let y = 0.5 * P; y <= 3.5 * P; y += 0.01) {
      const s = geometryAt(x, y, g);
      expect(s.axis).toBe(1);
      expect(s.height).toBeCloseTo(h0, 10);
      expect(Math.abs(s.grad[1])).toBeLessThan(1e-9);
    }
    // flotte bitince iner (çözgü merkezi kesişim 4'te alta)
    expect(crossingZ(0, 4, g).zw).toBeLessThan(0);
  });

  it('kesişim tablosu crossingZ ile aynı (periyot içinde)', () => {
    const inp = inputFromRows(twill31(), '#ffffff', '#000000', { warpPerCm: 20, weftPerCm: 20 });
    const g = geometryParamsFromInput(inp, 1, 0, 'v2');
    const tab = crossingTable(g, 4, 4);
    for (let j = 0; j < 4; j++)
      for (let i = 0; i < 4; i++) {
        const z = crossingZ(i, j, g);
        expect(tab[(j * 4 + i) * 2]).toBeCloseTo(z.zw, 6);
        expect(tab[(j * 4 + i) * 2 + 1]).toBeCloseTo(z.zf, 6);
      }
  });

  it('sık dokuda sıkışma: merkezler arası mesafe küçülür (açıkta 1, bantlı fixture d/p ≈ 0.84 → ≈ 0.43)', () => {
    expect(compressionFactor(0.3)).toBe(1);
    expect(compressionFactor(0.5)).toBe(1);
    expect(compressionFactor(0.84)).toBeCloseTo(0.43, 2);
    expect(compressionFactor(0.7)).toBeLessThan(compressionFactor(0.6));
    const inp = expandBandedFixture(banded as BandedFixture);
    const g = geometryParamsFromInput(inp, 1, 0, 'v2');
    const z = crossingZ(0, 0, g);
    const r = g.warpRadius(0);
    // bez bağlantıda toplam ≈ 0.86·r (fix-v2 prototip 0.45·r + 0.40·r)
    expect(Math.abs(z.zw - z.zf) / r).toBeGreaterThan(0.75);
    expect(Math.abs(z.zw - z.zf) / r).toBeLessThan(0.95);
  });

  it('sıkışma basıklığı en/boy ≤ 1.4; seyrekte daire; bant 3', () => {
    expect(flatteningV2(0.2, 0.5)).toBe(1);
    expect(flatteningV2(0.5, 0.5)).toBeCloseTo(1 + 0.8 * 0.2, 12);
    expect(flatteningV2(2, 0.5)).toBe(1.4);
    expect(flatteningV2(0.2, 0.5, 1, true)).toBe(3);
  });
});
