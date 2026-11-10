import { describe, expect, it } from 'vitest';
import { bakeDensity, lcm, MIN_TILE_MM, snapFreq, snapPeriod, tileFor } from '../tile';
import { generateHair, HAIR_ALPHA_MAX, HAIR_ALPHA_MIN, HAIR_GAP_ALPHA, HAIR_LEN_MAX, HAIR_LEN_MIN } from '../hair';
import { diameterMm, toTex } from '../yarn';
import { geometryAt, geometryParamsFromInput } from '../geometry';
import { expandBandedFixture, inputFromRows, type BandedFixture } from '../fixtures';
import { plain, twill22 } from '../../presets/weaves';
import banded from '../../../fixtures/banded-warp-sample.json';

const bandedInput = expandBandedFixture(banded as BandedFixture);

describe('döşeme', () => {
  it('lcm(örgü, renk dizisi) ve en az 12 mm', () => {
    expect(lcm(4, 6)).toBe(12);
    const t = tileFor(bandedInput);
    expect(t.threads[0]).toBe(251); // 251 tel = 62.75 mm ≥ 12
    expect(t.threads[1] % 4).toBe(0);
    expect(t.mm[1]).toBeGreaterThanOrEqual(MIN_TILE_MM);
    expect(t.colorExact).toBe(true);
    const p = tileFor(inputFromRows(plain(), '#fff', '#000', { warpPerCm: 40, weftPerCm: 32 }));
    expect(p.threads[0] % 2).toBe(0);
    expect(p.mm[0]).toBeGreaterThanOrEqual(MIN_TILE_MM);
    expect(p.mm[0]).toBeLessThan(MIN_TILE_MM + 0.5);
  });
  it('renk dizisi çok uzunsa yalnız örgü raporu (renk yaklaşık)', () => {
    const inp = inputFromRows(twill22(), '#fff', '#000');
    const many = { ...inp, warp: Array.from({ length: 2047 }, () => inp.warp[0]) };
    const t = tileFor(many);
    expect(t.colorExact).toBe(false);
    expect(t.threads[0] % 4).toBe(0);
  });
  it('pişirme yoğunluğu: aralık başına 16 texel, 64/mm ve kenar sınırı', () => {
    const t = tileFor(bandedInput);
    expect(bakeDensity(t, bandedInput, 1e6)).toBeCloseTo(64, 9); // 16 / 0.25 mm
    expect(bakeDensity(t, bandedInput, 2048)).toBeCloseTo(2048 / t.mm[0], 9);
  });
  it('periyot ve frekans yuvarlama döşemeye tam sığar, değişim küçük', () => {
    const L = 12.5;
    const p = snapPeriod(0.231, L);
    expect(Math.abs(L / p - Math.round(L / p))).toBeLessThan(1e-9);
    expect(Math.abs(p - 0.231) / 0.231).toBeLessThan(0.01);
    const f = snapFreq(0.45, 40);
    expect(Math.abs((f * 40) / (2 * Math.PI) - Math.round((f * 40) / (2 * Math.PI)))).toBeLessThan(1e-9);
    expect(Math.abs(f - 0.45) / 0.45).toBeLessThan(0.1);
    expect(snapFreq(0.01, 10)).toBeCloseTo((2 * Math.PI) / 10, 12); // en az bir periyot
  });
});

describe('tüylülük lifleri', () => {
  const t = tileFor(bandedInput);
  const hairs = generateHair(bandedInput, t);
  const pw = 10 / bandedInput.density.warpPerCm;
  it('deterministik; yoğunluk tüylülükle orantılı (0.35 → aralık² başına ≤ 5, boşluk ve zemine taşan hariç)', () => {
    expect(generateHair(bandedInput, t)).toEqual(hairs);
    const perPitch2 = hairs.length / ((t.mm[0] * t.mm[1]) / (pw * pw));
    expect(perPitch2).toBeGreaterThan(3);
    expect(perPitch2).toBeLessThan(5);
    const half = generateHair(bandedInput, t, 0.5);
    expect(half.length / hairs.length).toBeGreaterThan(0.4);
    expect(half.length / hairs.length).toBeLessThan(0.6);
    expect(generateHair(bandedInput, t, 0)).toEqual([]);
    expect(generateHair({ ...bandedInput, seed: 2 }, t)).not.toEqual(hairs);
  });
  it('kök iplik üstünde, döşeme içinde; uzunluk 0.1..0.3·d; soluk; açı eksen ±', () => {
    const dRoot = diameterMm(toTex(20, 'Ne'));
    const g = geometryParamsFromInput(bandedInput, 1, 0, 'v2');
    let devSum = 0;
    for (const h of hairs.slice(0, 2000)) {
      const [x, y] = h.pts[0];
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(t.mm[1]);
      expect(geometryAt(x, y, g).axis).toBe(h.axis);
      let len = 0;
      for (let k = 1; k < h.pts.length; k++) len += Math.hypot(h.pts[k][0] - h.pts[k - 1][0], h.pts[k][1] - h.pts[k - 1][1]);
      expect(len).toBeGreaterThanOrEqual(HAIR_LEN_MIN * dRoot - 1e-9);
      expect(len).toBeLessThanOrEqual(HAIR_LEN_MAX * dRoot + 1e-9);
      expect(h.alpha).toBeGreaterThanOrEqual(HAIR_ALPHA_MIN * HAIR_GAP_ALPHA - 1e-9);
      expect(h.alpha).toBeLessThanOrEqual(HAIR_ALPHA_MAX + 1e-9);
      const dx = h.pts[1][0] - x;
      const dy = h.pts[1][1] - y;
      const ang = Math.atan2(dy, dx);
      const axisAng = h.axis === 1 ? Math.PI / 2 : 0;
      let d = Math.abs(ang - axisAng) % Math.PI;
      d = Math.min(d, Math.PI - d);
      devSum += d;
    }
    // |N(0, √(0.25² + 0.15²))| ortalaması ≈ 0.23 rad (iplik yönünde)
    const meanDev = devSum / Math.min(2000, hairs.length);
    expect(meanDev).toBeGreaterThan(0.15);
    expect(meanDev).toBeLessThan(0.32);
  });
  it('kök rengi kök ipliğin rengi', () => {
    const colors = new Set(hairs.map((h) => h.color.toUpperCase()));
    for (const c of colors) expect(['#E3DCC8', '#4E3A1E', '#CDAE66', '#B9AD8C', '#A99A78', '#D8CFB6']).toContain(c);
  });
});
