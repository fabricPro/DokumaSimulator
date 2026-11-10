import { describe, expect, it } from 'vitest';
import { CARD_WIDTH_MM, cssPxPerMm, resolvableMm, VIEW_DISTANCE_MM, viewBakeDensity, viewBlurMm } from '../viewDistance';
import { crossSectionAspect, spreadFactor } from '../geometry';
import { inputFromRows } from '../fixtures';
import { plain } from '../../presets/weaves';

describe('bakış mesafesi', () => {
  it('1 yay dakikası: 40 cm → ~0.12 mm, 2 m → ~0.58 mm', () => {
    expect(resolvableMm(VIEW_DISTANCE_MM.eye)).toBeCloseTo(0.1164, 3);
    expect(resolvableMm(VIEW_DISTANCE_MM.far)).toBeCloseTo(0.5818, 3);
  });
  it('filtre σ: en az 2·çözünürlük ve 0.35·en büyük aralık; Uzak ≥ Göz', () => {
    const inp = inputFromRows(plain(), '#ffffff', '#000000', { warpPerCm: 15, weftPerCm: 15 });
    const eye = viewBlurMm('eye', inp);
    expect(eye).toBeCloseTo(Math.max(2 * 0.1164, 0.35 * (10 / 15)), 3);
    expect(viewBlurMm('far', inp)).toBeCloseTo(2 * resolvableMm(2000), 6);
    expect(viewBlurMm('far', inp)).toBeGreaterThan(eye);
  });
  it('fiziksel ölçek 96 dpi: 3.78 CSS px/mm; kart 85.6 mm ≈ 323.5 px; kalibrasyon çarpanı', () => {
    expect(cssPxPerMm()).toBeCloseTo(96 / 25.4, 9);
    expect(CARD_WIDTH_MM * cssPxPerMm()).toBeCloseTo(323.5, 1);
    expect(cssPxPerMm(1.25)).toBeCloseTo((96 / 25.4) * 1.25, 9);
  });
  it('pişirme yoğunluğu σ başına ≥ 4 texel, ≤ 24 texel/mm', () => {
    expect(viewBakeDensity(0.5)).toBe(8);
    expect(viewBakeDensity(0.05)).toBe(24);
    expect(viewBakeDensity(10)).toBe(4);
  });
});

describe('iplik yayılması', () => {
  it('seyrek dokuda yayılmaz, sıklaştıkça yayılır; tip sırası filament > tekstüre > tek kat > çok kat', () => {
    expect(spreadFactor(0.1, 1, 'spun', 2)).toBeCloseTo(1, 9);
    const f = (st: string, plies = 1) => spreadFactor(0.5, 1, st, plies);
    expect(f('filament')).toBeGreaterThan(f('textured'));
    expect(f('textured')).toBeGreaterThan(f('spun', 1));
    expect(f('spun', 1)).toBeGreaterThan(f('spun', 2));
    expect(spreadFactor(0.5, 1, 'spun', 2, 0)).toBe(1);
  });
  it('hacim korunur (A = en/boy, a·b = r²) ve genişlik aralığı aşmaz', () => {
    for (const st of ['spun', 'filament', 'textured'])
      for (const fill of [0.3, 0.6, 0.85, 0.95]) {
        const A = crossSectionAspect(fill, 1, 1, st, 1, 1, 0.9);
        expect(A).toBeGreaterThanOrEqual(1);
        expect(fill * Math.sqrt(A)).toBeLessThanOrEqual(Math.max(0.98, fill) + 1e-9);
      }
  });
  it('sık dokuda çapraz sistem doluluğu boşluk kapatmayı artırır', () => {
    expect(spreadFactor(0.67, 1, 'spun', 2, 1, 0.84)).toBeGreaterThan(spreadFactor(0.67, 1, 'spun', 2, 1, 0.3));
  });
});
