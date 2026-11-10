import { describe, expect, it } from 'vitest';
import { diameterMm, toTex } from '../yarn';
import {
  bandLimit,
  fibreLines,
  plyCentreSlope,
  plyPhase,
  plyProfile,
  plySpacingMm,
  reliefFactor,
  thicknessAlong,
  wobble,
  WOBBLE_STD,
} from '../relief';
import { bakeFiberNoise } from '../fiberNoise';
import { cosStep01, geometryAt, geometryParamsFromInput } from '../geometry';
import { expandBandedFixture, inputFromRows, type BandedFixture } from '../fixtures';
import { twill31 } from '../../presets/weaves';
import banded from '../../../fixtures/banded-warp-sample.json';

describe('çap', () => {
  it('Ne 20 → d = 0.0357·√(29.5/0.85) mm', () => {
    expect(toTex(20, 'Ne')).toBeCloseTo(29.525, 3);
    expect(diameterMm(toTex(20, 'Ne'))).toBeCloseTo(0.0357 * Math.sqrt(29.525 / 0.85), 9);
    expect(diameterMm(toTex(20, 'Ne'))).toBeCloseTo(0.2104, 3);
  });
  it('Dtex ve Denier: 167 dtex = 150 denier aynı çap', () => {
    expect(toTex(167, 'Dtex')).toBeCloseTo(16.7, 9);
    expect(toTex(150, 'Denier')).toBeCloseTo(16.6667, 3);
    expect(diameterMm(toTex(150, 'Denier'))).toBeCloseTo(diameterMm(toTex(166.667, 'Dtex')), 4);
  });
});

describe('kat aralığı (fiziksel K·π·d / (kat·tan α), K kalibre)', () => {
  const d = diameterMm(toTex(20, 'Ne'));
  it('bantlı fixture (Ne 20, 700 tur/m, 2 kat) → 1.1·d; 1400 tur/m → yarısı; büküm yoksa varsayılan 500', () => {
    expect(plySpacingMm(d, 700)).toBeCloseTo(1.1 * d, 12);
    expect(plySpacingMm(d, 1400)).toBeCloseTo(0.55 * d, 12);
    expect(plySpacingMm(d)).toBeCloseTo(1.1 * d * (700 / 500), 12);
    expect(plySpacingMm(d, 0)).toBe(Infinity);
    expect(() => plySpacingMm(0, 700)).toThrow();
  });
  it('fiziksel: aralık = K/(kat·T) — tan α = π·d·T ile çap sadeleşir; 3 kat → 2/3', () => {
    expect(plySpacingMm(2 * d, 700)).toBeCloseTo(plySpacingMm(d, 700), 12);
    expect(plySpacingMm(d, 700, 3) / plySpacingMm(d, 700)).toBeCloseTo(2 / 3, 12);
  });
  it('oluk eğimi (merkezde) 2·aralık/(π·d); 1.1·d → ≈0.70', () => {
    expect(plyCentreSlope(d, 1.1 * d)).toBeCloseTo(2.2 / Math.PI, 12);
  });
  it('Z çözgüde "/" : sağa gidince oluk yukarı kayar; S tersine', () => {
    const sp = 1.1 * d;
    // faz sabit (oluk) hattı: s = aralık·(k + yön·asin(v)/π)
    const sAt = (v: number, sign: 1 | -1) => (sp * sign * Math.asin(v)) / Math.PI;
    expect(sAt(0.5, 1)).toBeGreaterThan(sAt(-0.5, 1));
    expect(sAt(0.5, -1)).toBeLessThan(sAt(-0.5, -1));
    expect(plyPhase(sAt(0.3, 1), 0.3, sp, 1)).toBeCloseTo(0, 12);
  });
});

describe('kat profili |sin|^0.6', () => {
  it('oluk keskin (türev oluğa yaklaştıkça büyür), sırt yuvarlak (türev 0)', () => {
    const der = (x: number) => (plyProfile(x + 1e-6) - plyProfile(x - 1e-6)) / 2e-6;
    expect(plyProfile(0)).toBe(0);
    expect(plyProfile(Math.PI / 2)).toBeCloseTo(1, 12);
    expect(Math.abs(der(Math.PI / 2))).toBeLessThan(1e-4);
    expect(der(1e-3)).toBeGreaterThan(der(1e-1));
    expect(der(1e-4)).toBeGreaterThan(20); // 0.6·x^−0.4 → ∞
  });
  it('rölyef payı 0.82..1.05 aralığında', () => {
    expect(reliefFactor(0, 0, 0)).toBeCloseTo(0.82, 12);
    expect(reliefFactor(1, 1, 1)).toBeCloseTo(1.05, 12);
  });
  it('ince lif şeritleri ters (S) yönde ve 0.1·d periyotlu', () => {
    const d = 0.2;
    expect(fibreLines(0.02, 0, d, 1)).toBeCloseTo(fibreLines(0, 0, d, 1), 9);
    // Z ipte faz sabit hattı s = +0.6·cross ... ters yön: cross artınca s artar (S)
    expect(fibreLines(0.6 * 0.01, 0.01, d, 1)).toBeCloseTo(fibreLines(0, 0, d, 1), 9);
  });
  it('bant sınırlama: 2 px altında 0, 4 px üstünde 1', () => {
    expect(bandLimit(1.5)).toBe(0);
    expect(bandLimit(3)).toBeCloseTo(0.5, 12);
    expect(bandLimit(10)).toBe(1);
  });
});

describe('iplik boyunca düzgünsüzlük', () => {
  it('kalınlık 1 ± A içinde, A = 0 iken 1', () => {
    for (let s = 0; s < 50; s += 0.37) {
      expect(Math.abs(thicknessAlong(s, 0.3, 1.1, 0.06) - 1)).toBeLessThanOrEqual(0.06 + 1e-12);
      expect(thicknessAlong(s, 0.3, 1.1, 0)).toBe(1);
    }
  });
  it('yol sapması sınırlı (2·√3·0.025 aralık)', () => {
    for (let s = 0; s < 50; s += 0.37) expect(Math.abs(wobble(s, 1, 1, 0.4))).toBeLessThanOrEqual(2 * Math.sqrt(3) * WOBBLE_STD + 1e-12);
    expect(wobble(3, 0, 0, 1)).toBeCloseTo(0, 15);
  });
});

describe('lif gürültü dokusu', () => {
  const n = 128;
  const tex = bakeFiberNoise(n, 8, 0.8, 1);
  it('ortalama 0, std 1, aynı tohum aynı doku, farklı tohum farklı', () => {
    let m = 0;
    for (const v of tex) m += v;
    m /= tex.length;
    let s2 = 0;
    for (const v of tex) s2 += (v - m) ** 2;
    expect(Math.abs(m)).toBeLessThan(1e-6);
    expect(Math.sqrt(s2 / tex.length)).toBeCloseTo(1, 6);
    expect(bakeFiberNoise(n, 8, 0.8, 1)).toEqual(tex);
    expect(bakeFiberNoise(n, 8, 0.8, 2)).not.toEqual(tex);
  });
  const corr = (dx: number, dy: number) => {
    let s = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) s += tex[y * n + x] * tex[((y + dy) % n) * n + ((x + dx) % n)];
    return s / (n * n);
  };
  it('boyunca uzamış: korelasyon uzunluğu oranı ≈ 10 (prototip σ 4 : 0.4)', () => {
    const len = (along: boolean) => {
      for (let k = 1; k < n; k++) if (corr(along ? 0 : k, along ? k : 0) < 0.5) return k;
      return n;
    };
    const ratio = len(true) / len(false);
    expect(ratio).toBeGreaterThan(6);
    expect(ratio).toBeLessThan(16);
  });
  it('tekrar sınırında kesintisiz (sarmalı bulanıklık)', () => {
    // kenar komşuluğundaki fark, iç komşuluktaki farkla aynı istatistikte
    let edge = 0;
    let inner = 0;
    for (let x = 0; x < n; x++) {
      edge += (tex[(n - 1) * n + x] - tex[x]) ** 2;
      inner += (tex[(n / 2) * n + x] - tex[(n / 2 - 1) * n + x]) ** 2;
    }
    expect(edge / inner).toBeLessThan(2);
  });
});

describe('v2 geometri (cosine krepaj, tam elips)', () => {
  it('cosine geçiş uçlarda düz, ortada 0.5', () => {
    expect(cosStep01(0)).toBe(0);
    expect(cosStep01(0.5)).toBeCloseTo(0.5, 12);
    expect(cosStep01(1)).toBeCloseTo(1, 12);
  });
  it('3/1 dimide uzun atlamada düz, bağlantıda iner; matrise sadık', () => {
    const inp = inputFromRows(twill31(), '#ffffff', '#000000', { warpPerCm: 20, weftPerCm: 20 });
    const g = geometryParamsFromInput(inp, 1, 0, 'v2');
    const x = 1.5 * g.pitchWarp; // çözgü 1: atkı 0,1,2'de üstte
    const a = geometryAt(x, 0.6 * g.pitchWeft, g);
    const b = geometryAt(x, 1.4 * g.pitchWeft, g);
    expect(a.axis).toBe(1);
    expect(a.height).toBeCloseTo(b.height, 10);
    expect(geometryAt(x, 3.0 * g.pitchWeft, g).height).toBeLessThan(a.height);
    for (let i = -4; i < 8; i++)
      for (let j = -4; j < 8; j++)
        expect(geometryAt((i + 0.5) * g.pitchWarp, (j + 0.5) * g.pitchWeft, g).axis === 1).toBe(g.warpUp(i, j));
  });
  it('v2 bantlı fixture: hücre merkezinde üstteki iplik matristen', () => {
    const inp = expandBandedFixture(banded as BandedFixture);
    const g = geometryParamsFromInput(inp, 1, 0, 'v2');
    for (let i = 0; i < 251; i += 3)
      for (let j = -4; j < 4; j++)
        expect(geometryAt((i + 0.5) * g.pitchWarp, (j + 0.5) * g.pitchWeft, g).axis === 1).toBe(g.warpUp(i, j));
  });
  it('classic varsayılan değişmedi (model verilmezse)', () => {
    const inp = inputFromRows(twill31(), '#ffffff', '#000000');
    expect(geometryParamsFromInput(inp, 0, 0).model).toBe('classic');
  });
});
