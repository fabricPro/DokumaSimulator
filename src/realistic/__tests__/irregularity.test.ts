import { describe, expect, it } from 'vitest';
import { hash01, pcg3d, threadRand } from '../hash';
import {
  colorOffsetOklab,
  DEFAULT_IRREGULARITY,
  linearToOklab,
  oklabToLinear,
  positionOffset,
  resolveIrregularity,
  thicknessScale,
} from '../irregularity';
import { geometryAt, geometryParamsFromInput } from '../geometry';
import { inputFromRows } from '../fixtures';
import { twill22 } from '../../presets/weaves';

const inp = inputFromRows(twill22(), '#ffffff', '#000000', { warpPerCm: 25, weftPerCm: 22 });

describe('hash (GLSL pcg3d ikizi)', () => {
  it('uint aritmetiği: sonuçlar 32 bit işaretsiz, deterministik', () => {
    const a = pcg3d(1, 2, 3);
    expect(a).toEqual(pcg3d(1, 2, 3));
    for (const v of a) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(2 ** 32);
    }
    expect(pcg3d(1, 2, 4)).not.toEqual(a);
  });
  it('bilinen değer (pcg3d(0,0,0)) — GLSL ile aynı bit işlemleri', () => {
    // v = 1013904223 her bileşende; sonra sıralı karışım. Değer elle izlenen adımlarla sabitlenir.
    const x0 = 1013904223;
    let x = (x0 + Math.imul(x0, x0)) >>> 0;
    let y = (x0 + Math.imul(x0, x)) >>> 0;
    let z = (x0 + Math.imul(x, y)) >>> 0;
    x = (x ^ (x >>> 16)) >>> 0;
    y = (y ^ (y >>> 16)) >>> 0;
    z = (z ^ (z >>> 16)) >>> 0;
    x = (x + Math.imul(y, z)) >>> 0;
    expect(pcg3d(0, 0, 0)[0]).toBe(x);
  });
  it('hash01 [0,1], negatif indeks destekli, dağılım dengeli', () => {
    let sum = 0;
    for (let i = -500; i < 500; i++) {
      const h = hash01(i, 3, 7);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(1);
      sum += h;
    }
    expect(sum / 1000).toBeGreaterThan(0.45);
    expect(sum / 1000).toBeLessThan(0.55);
  });
  it('threadRand: eksen ve kanal ayrışır', () => {
    expect(threadRand(0, 5, 0, 1)).not.toBe(threadRand(1, 5, 0, 1));
    expect(threadRand(0, 5, 0, 1)).not.toBe(threadRand(0, 5, 1, 1));
    expect(threadRand(0, 5, 0, 1)).not.toBe(threadRand(0, 5, 0, 2));
  });
});

describe('düzensizlik sınırları', () => {
  const ir = resolveIrregularity(inp);
  it('varsayılanlar ve çarpan', () => {
    expect(ir.thickness).toBeCloseTo(DEFAULT_IRREGULARITY.thicknessPct / 100, 12);
    expect(resolveIrregularity(inp, 0)).toMatchObject({ thickness: 0, position: 0, colorDeltaE: 0 });
    expect(resolveIrregularity({ ...inp, irregularity: { thicknessPct: 10 } }, 2).thickness).toBeCloseTo(0.2, 12);
  });
  it('kalınlık ±%x, konum ±%y aralık içinde', () => {
    for (let i = -50; i < 50; i++) {
      expect(Math.abs(thicknessScale(0, i, ir) - 1)).toBeLessThanOrEqual(ir.thickness + 1e-12);
      expect(Math.abs(positionOffset(1, i, 0.4, ir))).toBeLessThanOrEqual(ir.position * 0.4 + 1e-12);
    }
  });
  it('renk sapması ΔE ≤ ayar (OKLab×100) ve OKLab gidiş-dönüş', () => {
    for (let i = 0; i < 100; i++) {
      const d = colorOffsetOklab(0, i, ir);
      expect(100 * Math.hypot(...d)).toBeLessThanOrEqual(ir.colorDeltaE + 1e-9);
    }
    const c: [number, number, number] = [0.6, 0.3, 0.1];
    const back = oklabToLinear(linearToOklab(c));
    back.forEach((v, k) => expect(v).toBeCloseTo(c[k], 6));
  });
});

describe('geometri ve tohum determinizmi', () => {
  const sample = (seed: number) => {
    const g = geometryParamsFromInput({ ...inp, seed }, 1, 1);
    const out: number[] = [];
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) out.push(geometryAt(x * 0.05, y * 0.05, g).height);
    return out;
  };
  it('aynı girdi + aynı tohum = birebir aynı', () => {
    expect(sample(42)).toEqual(sample(42));
  });
  it('farklı tohum farklı geometri', () => {
    const a = sample(42);
    const b = sample(43);
    const diff = a.filter((v, k) => v !== b[k]).length;
    expect(diff / a.length).toBeGreaterThan(0.2);
  });
  it('düzensizlik kapalıyken eşit aralık ve aynı yarıçap', () => {
    const g = geometryParamsFromInput(inp, 1, 0);
    expect(g.warpCenter(7)).toBeCloseTo(7.5 * g.pitchWarp, 12);
    expect(g.warpRadius(3)).toBe(g.warpRadius(4));
  });
  it('kayan iplik komşu hücreye taşsa da kesilmez (i±1 adayları)', () => {
    const g = geometryParamsFromInput({ ...inp, irregularity: { positionPct: 30, thicknessPct: 0, colorDeltaE: 0 } }, 1, 1);
    // Her çözgü merkezinde (kaymış konum) bir çözgü ya da üstündeki atkı görünür, zemin değil
    for (let i = 0; i < 20; i++) {
      for (let j = 0; j < 20; j++) {
        const s = geometryAt(g.warpCenter(i), g.weftCenter(j), g);
        expect(s.axis).not.toBe(0);
      }
    }
  });
});
