import { describe, expect, it } from 'vitest';
import { diameterMm, normalizeSystem, toTex } from '../yarnPhysics';
import { UniformPositionGenerator } from '../positions';
import { finishedDensities } from '../shrinkage';
import { ashenhurstMax, interlacing, squeeze } from '../squeeze';
import { computeMetrics, jamLevel, squeezeCheck } from '../metrics';
import { simulatePhysical } from '../simulate';
import { constantPhysicalRandom } from '../random';
import { plain, satin5, twill22, twill31 } from '../../../presets/weaves';
import { physicalExample } from '../../../presets/physicalExample';
import type { FabricSpec } from '../../types';

describe('numara dönüşümleri', () => {
  it('300 den = 33.33 tex, Ne 30 = 19.68 tex', () => {
    expect(toTex(300, 'Denier')).toBeCloseTo(33.333, 3);
    expect(toTex(30, 'Ne')).toBeCloseTo(19.683, 3);
  });
  it('Nm, Dtex, Tex ve takma adlar', () => {
    expect(toTex(50, 'Nm')).toBeCloseTo(20, 10);
    expect(toTex(167, 'Dtex')).toBeCloseTo(16.7, 10);
    expect(toTex(25, 'Tex')).toBe(25);
    expect(toTex(300, 'den')).toBeCloseTo(33.333, 3);
    expect(normalizeSystem('denye')).toBe('Denier');
    expect(() => toTex(0, 'Ne')).toThrow();
    expect(() => toTex(10, 'foo')).toThrow();
  });
});

describe('çap', () => {
  it('d = 0.0357·√(tex/ρ), varsayılan ρ = 0.85', () => {
    expect(diameterMm(33.333)).toBeCloseTo(0.0357 * Math.sqrt(33.333 / 0.85), 12);
    expect(diameterMm(33.333, 1.0)).toBeCloseTo(0.0357 * Math.sqrt(33.333), 12);
    // Daha yoğun iplik daha ince
    expect(diameterMm(20, 1.0)).toBeLessThan(diameterMm(20, 0.8));
  });
});

describe('çekme → mamul sıklık', () => {
  it('atkı çekmesi çözgü sıklığını, çözgü çekmesi atkı sıklığını artırır', () => {
    const f = finishedDensities(22, 18, 6, 10);
    expect(f.warp).toBeCloseTo(22 / 0.9, 12);
    expect(f.weft).toBeCloseTo(18 / 0.94, 12);
    expect(finishedDensities(22, 18, 0, 0)).toEqual({ warp: 22, weft: 18 });
    expect(() => finishedDensities(22, 18, 100, 0)).toThrow();
  });
});

describe('konum üretici', () => {
  it('referans indekslemesi: c_g = (g+0.5)p − p, n = ceil(view·D/10)+3', () => {
    const g = new UniformPositionGenerator(20); // p = 0.5 mm
    expect(Array.from(g.centers(0, 3))).toEqual([-0.25, 0.25, 0.75]);
    expect(g.indexRange(0, 8)).toEqual({ first: 0, count: 16 + 3 });
    expect(g.meanPitchMm()).toBe(0.5);
    // Kaydırılmış pencere aynı global konumları verir
    const r = g.indexRange(3.1, 5);
    expect(g.centers(r.first, 1)[0]).toBeCloseTo((r.first - 0.5) * 0.5, 12);
    expect(g.centers(r.first, 1)[0]).toBeLessThan(3.1);
  });
});

describe('squeeze', () => {
  it('çakışmayan iplikler değişmez', () => {
    const r = squeeze([0, 1, 2], [0.2, 0.2, 0.2]);
    expect(Array.from(r.width)).toEqual([1, 1, 1]);
    expect(r.anyJammed).toBe(false);
  });
  it('çakışan komşular gap/need oranında daralır, yükseklik s^-0.5', () => {
    const r = squeeze([0, 0.8], [0.5, 0.5]); // need 1.0, gap 0.8 → s = 0.8
    expect(r.width[0]).toBeCloseTo(0.8, 12);
    expect(r.width[1]).toBeCloseTo(0.8, 12);
    expect(r.height[0]).toBeCloseTo(0.8 ** -0.5, 12);
    expect(r.anyJammed).toBe(false);
  });
  it('alt sınır 0.55; altına inen "sıkıştı" işaretlenir', () => {
    const r = squeeze([0, 0.5, 2], [0.5, 0.5, 0.1]); // s = 0.5 < 0.55
    expect(r.width[0]).toBe(0.55);
    expect(r.width[1]).toBe(0.55);
    expect(r.width[2]).toBe(1);
    expect(Array.from(r.jammed)).toEqual([1, 1, 0]);
    expect(r.anyJammed).toBe(true);
  });
});

describe('Ashenhurst E/I', () => {
  it('bezayağı E=2 I=2, 3/1 dimi E=4 I=2', () => {
    expect(interlacing(plain(), 'warp')).toEqual({ E: 2, I: 2 });
    expect(interlacing(plain(), 'weft')).toEqual({ E: 2, I: 2 });
    expect(interlacing(twill31(), 'warp')).toEqual({ E: 4, I: 2 });
    expect(interlacing(twill31(), 'weft')).toEqual({ E: 4, I: 2 });
    expect(interlacing(twill22(), 'warp')).toEqual({ E: 4, I: 2 });
    expect(interlacing(satin5(), 'warp')).toEqual({ E: 5, I: 2 });
  });
  it('max = 10/d · E/(E+I)', () => {
    expect(ashenhurstMax(plain(), 'warp', 0.2).max).toBeCloseTo(50 * (2 / 4), 12);
    expect(ashenhurstMax(twill31(), 'weft', 0.25).max).toBeCloseTo(40 * (4 / 6), 12);
  });
  it('uyarı seviyeleri kesin sınır değil: >100 sarı, >115 kırmızı', () => {
    expect(jamLevel(99)).toBe('ok');
    expect(jamLevel(101)).toBe('warn');
    expect(jamLevel(116)).toBe('high');
  });
});

describe('metrikler', () => {
  const spec: FabricSpec = {
    version: 2,
    weave: plain(),
    warpSlots: [{ name: 'A', count: 30, system: 'Tex', color: '#fff', twist: 'S' }],
    weftSlots: [{ name: 'A', count: 20, system: 'Tex', color: '#000', twist: 'S' }],
    warpSequence: [0],
    weftSequence: [0],
    warpDensityLoom: 20,
    weftDensityLoom: 15,
    warpShrinkPct: 0,
    weftShrinkPct: 0,
    warpCrimpShare: 0.4,
  };

  it('kıvrımlı gramaj = Σ sıklık·100·tex/1000·(1+kıvrım)', () => {
    const m = computeMetrics(spec);
    const dw = diameterMm(30);
    const df = diameterMm(20);
    const hW = ((dw + df) / 2) * 0.4;
    const hF = ((dw + df) / 2) * 0.6;
    const cW = (8 / 3) * (hW / (10 / 15)) ** 2 * (2 / 2);
    const cF = (8 / 3) * (hF / (10 / 20)) ** 2 * (2 / 2);
    expect(m.crimpWarp).toBeCloseTo(100 * cW, 10);
    expect(m.crimpWeft).toBeCloseTo(100 * cF, 10);
    expect(m.gsm).toBeCloseTo(20 * 100 * 0.03 * (1 + cW) + 15 * 100 * 0.02 * (1 + cF), 10);
  });

  it('örtme = 1 − (1−c1)(1−c2), sıkışma = D/max', () => {
    const m = computeMetrics(spec);
    const c1 = (20 / 10) * diameterMm(30);
    const c2 = (15 / 10) * diameterMm(20);
    expect(m.cover).toBeCloseTo(100 * (1 - (1 - c1) * (1 - c2)), 10);
    expect(m.jamWarp).toBeCloseTo((100 * 20) / ((10 / diameterMm(30)) * 0.5), 10);
  });

  it('referans örneği: referans çıktısıyla aynı metrikler (tezgah)', () => {
    // Referans: tezgah {'cover': 75.1, 'jam_w': 91.5, 'jam_f': 84.1, 'gsm': 195.0} (pencere ortalaması)
    const s = physicalExample(0, 0);
    const res = simulatePhysical(s, { x0Mm: 0, y0Mm: 0, widthMm: 2, heightMm: 2, pxPerMm: 20 }, { random: constantPhysicalRandom() });
    const big = simulatePhysical(s, { x0Mm: 0, y0Mm: 0, widthMm: 8, heightMm: 8, pxPerMm: 4 }, { random: constantPhysicalRandom() });
    const m = computeMetrics(s, { warpSlotsUsed: big.warpSlotsUsed, weftSlotsUsed: big.weftSlotsUsed });
    expect(m.cover).toBeCloseTo(75.05, 1);
    expect(m.jamWarp).toBeCloseTo(91.54, 1);
    expect(m.jamWeft).toBeCloseTo(84.13, 1);
    expect(m.gsm).toBeCloseTo(194.96, 1);
    expect(res.image.width).toBe(40);
  });

  it('squeezeCheck: aşırı sıklıkta "sıkıştı"', () => {
    expect(squeezeCheck(spec).jammedWarp).toBe(false);
    const dense = { ...spec, warpDensityLoom: 120 };
    const c = squeezeCheck(dense);
    expect(c.jammedWarp).toBe(true);
    expect(c.minScaleWarp).toBeLessThan(0.55);
  });
});

describe('simulate', () => {
  it('çekme arttıkça açıklık azalır', () => {
    const view = { x0Mm: 0, y0Mm: 0, widthMm: 4, heightMm: 4, pxPerMm: 40 };
    const a = simulatePhysical(physicalExample(0, 0), view, { random: constantPhysicalRandom(), scaleBar: false });
    const b = simulatePhysical(physicalExample(12, 20), view, { random: constantPhysicalRandom(), scaleBar: false });
    expect(b.openPct).toBeLessThan(a.openPct);
    expect(b.Dw).toBeCloseTo(27.5, 6);
  });
  it('0. atkı en altta (alttan yukarı)', () => {
    const spec: FabricSpec = {
      version: 2,
      weave: [[false], [false]],
      warpSlots: [{ name: 'A', count: 20, system: 'Tex', color: '#00ff00', twist: 'S' }],
      weftSlots: [
        { name: 'A', count: 20, system: 'Tex', color: '#ff0000', twist: 'S' },
        { name: 'B', count: 20, system: 'Tex', color: '#0000ff', twist: 'S' },
      ],
      warpSequence: [0],
      weftSequence: [0, 1],
      warpDensityLoom: 10,
      weftDensityLoom: 10,
      warpShrinkPct: 0,
      weftShrinkPct: 0,
      warpCrimpShare: 0.4,
    };
    // Atkı merkezleri: g=1 → 0.5 mm (kırmızı değil: g=1 slot B mavi), g=2 → 1.5 mm (slot A kırmızı)
    const res = simulatePhysical(spec, { x0Mm: 0, y0Mm: 0, widthMm: 2, heightMm: 2, pxPerMm: 50 }, { random: constantPhysicalRandom(), scaleBar: false });
    const px = (xMm: number, yMm: number) => {
      const x = Math.round(xMm * 50);
      const y = res.image.height - 1 - Math.round(yMm * 50);
      const o = (y * res.image.width + x) * 4;
      return [res.image.data[o], res.image.data[o + 1], res.image.data[o + 2]];
    };
    const low = px(0.95, 0.5); // y = 0.5 mm atkısı (alt)
    const high = px(0.95, 1.5); // y = 1.5 mm atkısı (üst)
    expect(low[2]).toBeGreaterThan(low[0]); // g=1 → B mavi
    expect(high[0]).toBeGreaterThan(high[2]); // g=2 → A kırmızı
  });
});
