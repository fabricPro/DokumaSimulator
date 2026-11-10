import { describe, expect, it } from 'vitest';
import {
  grooveSpacingMm,
  linearToSrgb,
  LUSTER_SPECULAR,
  QUALITY_SAMPLES,
  softClip,
  srgbToLinear,
  twistAngle,
} from '../surface';
import { lightDirection } from '../renderer';

describe('büküm', () => {
  it('sarmal açısı tan θ = π·d·T', () => {
    const t = twistAngle(0.21, 0.7);
    expect(Math.tan(t)).toBeCloseTo(Math.PI * 0.21 * 0.7, 12);
    expect((t * 180) / Math.PI).toBeGreaterThan(20);
    expect((t * 180) / Math.PI).toBeLessThan(30);
    expect(twistAngle(0.21, 0)).toBe(0);
    // S ve Z aynı açı (yön işaretle)
    expect(twistAngle(0.21, -0.7)).toBe(t);
  });
  it('2 katlı oluk aralığı 1/(2T); büküm yoksa sonsuz', () => {
    expect(grooveSpacingMm(0.5)).toBeCloseTo(1, 12);
    expect(grooveSpacingMm(0.7, 3)).toBeCloseTo(1 / 2.1, 12);
    expect(grooveSpacingMm(0)).toBe(Infinity);
  });
});

describe('parlaklık ve kalite', () => {
  it('parlak > yarı mat > mat: şiddet artar, parlama daralır', () => {
    const { mat, yarimat, parlak } = LUSTER_SPECULAR;
    expect(parlak.strength).toBeGreaterThan(yarimat.strength);
    expect(yarimat.strength).toBeGreaterThan(mat.strength);
    expect(parlak.exponent).toBeGreaterThan(yarimat.exponent);
    expect(yarimat.exponent).toBeGreaterThan(mat.exponent);
  });
  it('kalite seviyeleri AO ve gölge örneklerini düşürür', () => {
    expect(QUALITY_SAMPLES.low.ao).toBeLessThan(QUALITY_SAMPLES.medium.ao);
    expect(QUALITY_SAMPLES.medium.ao).toBeLessThan(QUALITY_SAMPLES.high.ao);
    expect(QUALITY_SAMPLES.high.ao).toBeLessThanOrEqual(3); // AO ölçek sayısı
    expect(QUALITY_SAMPLES.high.shadow).toBeLessThanOrEqual(64); // shader döngü sınırı
    expect(QUALITY_SAMPLES.low.shadow).toBe(0); // düşük: gölge kapalı
    expect(QUALITY_SAMPLES.medium.shadow).toBe(QUALITY_SAMPLES.high.shadow / 2);
  });
});

describe('renk uzayı', () => {
  it('sRGB ↔ doğrusal gidiş-dönüş ve bilinen değerler', () => {
    expect(srgbToLinear(1)).toBeCloseTo(1, 12);
    expect(srgbToLinear(0.5)).toBeCloseTo(0.214041, 5);
    for (let c = 0; c <= 1; c += 0.05) expect(linearToSrgb(srgbToLinear(c))).toBeCloseTo(c, 9);
  });
  it('yumuşak tavan monoton ve 1\'de ≈1 (beyaz patlamaz)', () => {
    expect(softClip(1)).toBeCloseTo(1, 12);
    expect(softClip(2)).toBeLessThan(2);
    expect(softClip(0.5)).toBeGreaterThan(softClip(0.4));
  });
});

describe('ışık yönü', () => {
  it('azimut 135°, yükseklik 45°: sol üstten, birim vektör', () => {
    const [x, y, z] = lightDirection(135, 45);
    expect(x).toBeLessThan(0);
    expect(y).toBeGreaterThan(0);
    expect(z).toBeCloseTo(Math.SQRT1_2, 12);
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 12);
  });
});
