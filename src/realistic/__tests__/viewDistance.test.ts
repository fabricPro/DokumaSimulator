import { describe, expect, it } from 'vitest';
import {
  CARD_WIDTH_MM,
  cssPxPerMm,
  effectiveFwhmMm,
  filterFwhmMm,
  filteredBakeDensity,
  footprintMm,
  minYarnDiameterMm,
  resolvableMm,
  sigmaFromFwhm,
  useFilteredPath,
  VIEW_DISTANCE_MM,
} from '../viewDistance';
import { crossSectionAspect, spreadFactor } from '../geometry';
import { inputFromRows } from '../fixtures';
import { plain } from '../../presets/weaves';

describe('bakış modu = kumaş uzayında algısal filtre', () => {
  it('mesafe → filtre çapı: 1 yay dakikası × mesafe (40 cm 0.116 mm, 2 m 0.582 mm, Lup 0)', () => {
    expect(resolvableMm(VIEW_DISTANCE_MM.eye)).toBeCloseTo(0.1164, 3);
    expect(filterFwhmMm('eye')).toBeCloseTo(0.1164, 3);
    expect(filterFwhmMm('far')).toBeCloseTo(0.5818, 3);
    expect(filterFwhmMm('loupe')).toBe(0);
  });
  it('σ = FWHM / 2.355; çap zoom\'dan bağımsız (kumaşa bağlı)', () => {
    expect(sigmaFromFwhm(2.3548)).toBeCloseTo(1, 3);
    // zoom'la değişmez: etkin çap yakın zoomda mod çapıdır
    expect(effectiveFwhmMm('eye', 200)).toBeCloseTo(filterFwhmMm('eye'), 9);
    expect(effectiveFwhmMm('eye', 400)).toBeCloseTo(filterFwhmMm('eye'), 9);
  });
  it('otomatik LOD: ayak izi büyükse ayak izine eşit minimum filtre (Lup 15 px/mm → 0.067 mm)', () => {
    expect(footprintMm(15)).toBeCloseTo(1 / 15, 9);
    expect(effectiveFwhmMm('loupe', 15)).toBeCloseTo(1 / 15, 9);
    expect(effectiveFwhmMm('loupe', 200)).toBeCloseTo(0.005, 9);
    expect(effectiveFwhmMm('eye', 2)).toBeCloseTo(0.5, 9);
  });
  it('filtreli yol: Göz / Uzak her zaman; Lup\'ta iplik 3 pikselin altına inince', () => {
    const dMin = 0.2;
    expect(useFilteredPath('eye', 300, dMin)).toBe(true);
    expect(useFilteredPath('far', 300, dMin)).toBe(true);
    expect(useFilteredPath('loupe', 12, dMin)).toBe(true); // 0.2 mm × 12 px/mm = 2.4 px < 3
    expect(useFilteredPath('loupe', 15, 0.17)).toBe(true); // Bendix çözgüsü 60/2 Ne ⌀ 0.17 mm, 15 px/mm → 2.6 px
    expect(useFilteredPath('loupe', 20, dMin)).toBe(false); // 4 px / iplik → keskin yol
    expect(useFilteredPath('loupe', 100, dMin)).toBe(false);
  });
  it('pişirme yoğunluğu kovası: 2\'nin kuvveti; ≥ 3 texel / ince iplik; FWHM başına ≤ 8 texel; ≤ 64', () => {
    const dMin = 0.2; // ≥ 15 texel/mm → 16
    expect(filteredBakeDensity(filterFwhmMm('eye'), 4, dMin)).toBe(16);
    expect(filteredBakeDensity(filterFwhmMm('eye'), 500, dMin)).toBe(64);
    expect(filteredBakeDensity(filterFwhmMm('far'), 500, dMin)).toBe(16); // 8 / 0.58 = 13.7 < 15 → 16
    expect(filteredBakeDensity(0, 12, dMin)).toBe(16);
    for (const ppm of [3, 7, 20, 50, 120]) {
      const d = filteredBakeDensity(filterFwhmMm('eye'), ppm, dMin);
      expect(Math.log2(d) % 1).toBe(0);
    }
  });
  it('en ince iplik çapı', () => {
    const inp = inputFromRows(plain(), '#ffffff', '#000000');
    expect(minYarnDiameterMm(inp)).toBeGreaterThan(0.1);
    expect(minYarnDiameterMm(inp)).toBeLessThan(0.25);
  });
  it('gerçek boyut ön ayarı: 96 dpi → 3.78 CSS px/mm; kart 85.6 mm ≈ 323.5 px; kalibrasyon çarpanı', () => {
    expect(cssPxPerMm()).toBeCloseTo(96 / 25.4, 9);
    expect(CARD_WIDTH_MM * cssPxPerMm()).toBeCloseTo(323.5, 1);
    expect(cssPxPerMm(1.25)).toBeCloseTo((96 / 25.4) * 1.25, 9);
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
