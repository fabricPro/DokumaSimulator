import { describe, expect, it } from 'vitest';
import { hexToRgba, packFabric, validateInput } from '../pack';
import { cellAt, flatColorAt, pitchMm, pitchPx, pixelToMm } from '../scale';
import { diameterMm, toTex } from '../yarn';
import { bandCell, expandBandedFixture, inputFromRows, type BandedFixture } from '../fixtures';
import { fabricInputFromSpec } from '../adapters/fromSpec';
import * as engine from '../../render-engine/physical/yarnPhysics';
import { brokenTwill13, plain, twill31 } from '../../presets/weaves';
import { physicalExample } from '../../presets/physicalExample';
import banded from '../../../fixtures/banded-warp-sample.json';
import type { ViewParams } from '../types';

const view = (pxPerCm: number, ox = 0, oy = 0): ViewParams => ({
  pxPerCm,
  offsetCm: [ox, oy],
  light: { azimuthDeg: 135, elevationDeg: 45 },
  quality: 'medium',
});

describe('çap hesabı', () => {
  it('render-engine ile aynı formül (d = 0.0357·√(tex/ρ), ρ = 0.85)', () => {
    for (const [c, u] of [
      [20, 'Ne'],
      [34, 'Nm'],
      [167, 'Dtex'],
      [150, 'Denier'],
      [30, 'Tex'],
    ] as const) {
      expect(toTex(c, u)).toBeCloseTo(engine.toTex(c, u), 12);
      expect(diameterMm(toTex(c, u))).toBeCloseTo(engine.diameterMm(engine.toTex(c, u)), 12);
    }
    expect(diameterMm(toTex(20, 'Ne'))).toBeCloseTo(0.0357 * Math.sqrt(29.525 / 0.85), 10);
    expect(() => toTex(0, 'Ne')).toThrow();
  });
});

describe('matris → doku', () => {
  it('düz dizi [atkı·warps + çözgü], atkı 0 alt; doku satırı = atkı', () => {
    const inp = inputFromRows(twill31(), '#ffffff', '#000000');
    const p = packFabric(inp);
    expect(p.weave.width).toBe(4);
    expect(p.weave.height).toBe(4);
    // twill31 satır 0: XXX. ; satır 1: .XXX
    expect(Array.from(p.weave.data.slice(0, 4))).toEqual([1, 1, 1, 0]);
    expect(Array.from(p.weave.data.slice(4, 8))).toEqual([0, 1, 1, 1]);
  });
  it('renk ve tip tabloları, iplik tipi dokusu (çap, işaretli büküm, parlaklık, tüy)', () => {
    const inp = inputFromRows(plain(), '#e8e2d0', '#3f4f6b');
    const p = packFabric(inp);
    expect(Array.from(p.warpColors)).toEqual(hexToRgba('#e8e2d0'));
    expect(Array.from(p.weftTypes)).toEqual([1]);
    expect(p.yarnTypes[0]).toBeCloseTo(diameterMm(toTex(20, 'Ne')), 6);
    expect(p.yarnTypes[1]).toBeCloseTo(0.7, 6); // Z → +700 tur/m = 0.7 tur/mm
    expect(p.yarnTypes[5]).toBeCloseTo(-0.3, 6); // S → −
    expect(p.yarnTypes[6]).toBe(2); // parlak
    expect(p.yarnTypes[7]).toBeCloseTo(0.05, 6);
  });
  it('doğrulama hataları', () => {
    const inp = inputFromRows(plain(), '#ffffff', '#000000');
    expect(() => validateInput({ ...inp, weave: { ...inp.weave, data: new Uint8Array(3) } })).toThrow(/2×2/);
    expect(() => validateInput({ ...inp, warp: [{ color: '#fff', yarnType: 0 }] })).not.toThrow();
    expect(() => packFabric({ ...inp, warp: [{ color: '#fff', yarnType: 0 }] })).toThrow(/renk/);
    expect(() => validateInput({ ...inp, weft: [{ color: '#000000', yarnType: 9 }] })).toThrow(/iplik tipi/);
  });
});

describe('sıklık → piksel aralığı ve hücre bulma', () => {
  it('aralık = 10/sıklık mm; px = mm × px/mm', () => {
    expect(pitchMm(40)).toBeCloseTo(0.25, 12);
    expect(pitchPx(40, 500)).toBeCloseTo(12.5, 12);
    expect(pitchPx(32, 160)).toBeCloseTo(5, 12);
  });
  it('piksel → mm (alttan, ofsetli)', () => {
    expect(pixelToMm(0, 0, view(500))).toEqual([0, 0]);
    const [x, y] = pixelToMm(25, 50, view(500, 0.1, 0.2));
    expect(x).toBeCloseTo(1 + 0.5, 5);
    expect(y).toBeCloseTo(2 + 1, 5);
  });
  it('rapor tekrarı modulo ile (negatif konumlar dahil)', () => {
    const inp = inputFromRows(twill31(), '#ffffff', '#000000', { warpPerCm: 10, weftPerCm: 10 });
    // aralık 1 mm; hücre (i, j) = (floor x, floor y)
    for (let i = -9; i < 9; i++) {
      for (let j = -9; j < 9; j++) {
        const c = cellAt(i + 0.5, j + 0.5, inp);
        expect(c.warp).toBe(i);
        expect(c.weft).toBe(j);
        const expected = (((i - j) % 4) + 4) % 4 !== 3; // twill31 tanımı
        expect(c.warpUp).toBe(expected);
      }
    }
  });
  it('düz renk ikizi: çözgü üstteyse çözgü rengi, değilse atkı rengi', () => {
    const inp = inputFromRows(plain(), '#ffffff', '#000000', { warpPerCm: 10, weftPerCm: 10 });
    // 100 px/cm = 10 px/mm, hücre 10 px; (0,0) hücresi bezayağında çözgü üstte
    expect(flatColorAt(5, 5, inp, view(100))).toBe('#ffffff');
    expect(flatColorAt(15, 5, inp, view(100))).toBe('#000000');
  });
});

describe('bantlı çözgü fixture', () => {
  const f = banded as BandedFixture;
  const inp = expandBandedFixture(f);
  it('251 tel, 4 atkı raporu, sıklıklar', () => {
    expect(inp.weave.warps).toBe(251);
    expect(inp.weave.wefts).toBe(4);
    expect(inp.warp).toHaveLength(251);
    expect(inp.density).toEqual({ warpPerCm: 40, weftPerCm: 32 });
    expect(inp.weft).toEqual([{ color: '#D8CFB6', yarnType: 0 }]);
  });
  it('renk sırası bant tanımıyla aynı', () => {
    const runs: Array<[number, string]> = [];
    for (const t of inp.warp) {
      const last = runs[runs.length - 1];
      if (last && last[1] === t.color) last[0]++;
      else runs.push([1, t.color]);
    }
    // Aynı renkli komşu bant olmadığından koşular bantlarla birebir
    expect(runs).toEqual(f.warpBands.map((b) => [b.ends, b.color]));
  });
  it('bant örgüleri: krem bezayağı, hardal / kahve / taba 3/1 dimi, ince çizgiler bezayağı', () => {
    let c0 = 0;
    for (const b of f.warpBands) {
      for (let k = 0; k < b.ends; k++) {
        const c = c0 + k;
        for (let r = 0; r < 4; r++) expect(inp.weave.data[r * 251 + c] === 1).toBe(bandCell(b.weave, c, r));
      }
      if (b.ends <= 3) expect(b.weave).toBe('plain');
      if (b.color === '#E3DCC8') expect(b.weave).toBe('plain');
      if (b.color === '#CDAE66' || b.color === '#A99A78' || (b.color === '#4E3A1E' && b.ends > 3)) expect(b.weave).toBe('twill31-S');
      c0 += b.ends;
    }
    // Z dimi köşegeni: bir atkı yukarıda üstteki çözgüler bir sağa kayar
    expect(bandCell('twill22-Z', 5, 1)).toBe(bandCell('twill22-Z', 4, 0));
    // 3/1-S: bir atkı yukarıda bir SOLA kayar (köşegen sol üstten sağ alta); 4 hücrenin 3'ü çözgü
    expect(bandCell('twill31-S', 4, 1)).toBe(bandCell('twill31-S', 5, 0));
    for (let r = 0; r < 4; r++) expect([0, 1, 2, 3].filter((c) => bandCell('twill31-S', c, r)).length).toBe(3);
  });
  it('prototip matrisiyle birebir (prototip satırı j aşağı, r = −j)', () => {
    // prototip: M(i, j) = dimi ? (i − j) mod 4 < 3 : (i + j) % 2 == 0
    const m = (a: number, n: number) => ((a % n) + n) % n;
    let c0 = 0;
    for (const b of f.warpBands) {
      for (let k = 0; k < b.ends; k++) {
        const i = c0 + k;
        for (let j = 0; j < 8; j++) {
          const proto = b.weave === 'plain' ? m(i + j, 2) === 0 : m(i - j, 4) < 3;
          expect(bandCell(b.weave, i, -j)).toBe(proto);
        }
      }
      c0 += b.ends;
    }
  });
});

describe('kırık dimi ve adaptör', () => {
  it('1/3 kırık dimi satırları: 1000 / 0100 / 0001 / 0010', () => {
    expect(brokenTwill13().map((r) => r.map((v) => (v ? 1 : 0)).join(''))).toEqual(['1000', '0100', '0001', '0010']);
  });
  it('FabricSpec → FabricInput: yönelim, slot tipleri, diziler, sıklık', () => {
    const spec = physicalExample(6, 10);
    const inp = fabricInputFromSpec(spec);
    expect(inp.weave.warps).toBe(spec.weave[0].length);
    // Gerçekçi tel i = klasik tel g = i + 1 (aynı mm konumu): örgü ve diziler bir tel kaydırılmış
    const W = spec.weave[0].length;
    const H = spec.weave.length;
    const rot = <T,>(a: T[]) => a.map((_, i) => a[(i + 1) % a.length]);
    expect(inp.weave.data[0]).toBe(spec.weave[1 % H][1 % W] ? 1 : 0);
    expect(inp.weave.data[inp.weave.warps * 3 + 5]).toBe(spec.weave[4 % H][6 % W] ? 1 : 0);
    expect(inp.yarnTypes).toHaveLength(spec.warpSlots.length + spec.weftSlots.length);
    expect(inp.warp.map((t) => t.yarnType)).toEqual(rot(spec.warpSequence));
    expect(inp.weft.map((t) => t.yarnType)).toEqual(rot(spec.weftSequence).map((i) => spec.warpSlots.length + i));
    expect(inp.density.warpPerCm).toBe(spec.warpDensityLoom);
    expect(() => packFabric(inp)).not.toThrow();
  });
  it('mamul paneli: çekme sonrası ortalama sıklık (en çekmesi çözgüyü, boy çekmesi atkıyı sıklaştırır)', () => {
    const spec = { ...physicalExample(6, 10), warpShrinkPct: 6, weftShrinkPct: 10 };
    const loom = fabricInputFromSpec(spec);
    const fin = fabricInputFromSpec(spec, undefined, { densities: 'finished' });
    expect(fin.density.warpPerCm).toBeCloseTo(loom.density.warpPerCm / (1 - 0.1), 9);
    expect(fin.density.weftPerCm).toBeCloseTo(loom.density.weftPerCm / (1 - 0.06), 9);
    expect(fabricInputFromSpec({ ...spec, warpShrinkPct: 0, weftShrinkPct: 0 }, undefined, { densities: 'finished' }).density).toEqual(loom.density);
  });
});
