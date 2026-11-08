import { describe, expect, it } from 'vitest';
import { spacingMm, toTex, yarnDiameterMm, yarnGeometry } from '../geometry';

describe('toTex', () => {
  it('dört numara sistemini çevirir', () => {
    expect(toTex({ count: 30, system: 'Ne' })).toBeCloseTo(590.5 / 30, 10);
    expect(toTex({ count: 50, system: 'Nm' })).toBeCloseTo(20, 10);
    expect(toTex({ count: 167, system: 'Dtex' })).toBeCloseTo(16.7, 10);
    expect(toTex({ count: 150, system: 'Denier' })).toBeCloseTo(150 / 9, 10);
  });
  it('geçersiz numarayı reddeder', () => {
    expect(() => toTex({ count: 0, system: 'Ne' })).toThrow();
    expect(() => toTex({ count: -2, system: 'Nm' })).toThrow();
  });
});

describe('yarnDiameterMm', () => {
  it('varsayılan ρ = 1.38 ile d = 0.0357·√(tex/ρ)', () => {
    expect(yarnDiameterMm({ count: 20, system: 'Nm' })).toBeCloseTo(0.0357 * Math.sqrt(50 / 1.38), 10);
  });
  it('ρ girdiden değiştirilebilir', () => {
    const cotton = yarnDiameterMm({ count: 20, system: 'Nm', fiberDensity: 1.52 });
    expect(cotton).toBeCloseTo(0.0357 * Math.sqrt(50 / 1.52), 10);
    expect(cotton).toBeLessThan(yarnDiameterMm({ count: 20, system: 'Nm' }));
  });
});

describe('spacing ve kırpma', () => {
  it('aralık = 10 / sıklık', () => {
    expect(spacingMm(25)).toBeCloseTo(0.4, 10);
    expect(() => spacingMm(0)).toThrow();
  });
  it('çap aralıktan küçükse boşluk kalır', () => {
    const g = yarnGeometry({ count: 60, system: 'Ne' }, 20);
    expect(g.width).toBeCloseTo(g.diameter, 10);
    expect(g.gap).toBeCloseTo(g.spacing - g.diameter, 10);
    expect(g.compression).toBeLessThan(1);
  });
  it('çap aralıktan büyükse aralığa kırpılır ve sıkışma > 1 olur', () => {
    const g = yarnGeometry({ count: 6, system: 'Ne' }, 60);
    expect(g.width).toBeCloseTo(g.spacing, 10);
    expect(g.gap).toBe(0);
    expect(g.compression).toBeGreaterThan(1);
  });
});
