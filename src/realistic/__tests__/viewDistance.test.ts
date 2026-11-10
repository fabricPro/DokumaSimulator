import { describe, expect, it } from 'vitest';
import {
  CARD_WIDTH_MM,
  cssPxPerMm,
  effectiveFwhmMm,
  FILTER_MAX_SIGMA_PX,
  MAGNIFIER_MIN_YARN_PX,
  REAL_BLEND_END_PX,
  REAL_BLEND_START_PX,
  cappedFwhmMm,
  farFilterDistance,
  meanDiameter,
  realBlend,
  realWeight,
  filterFwhmMm,
  filterSigmaMm,
  materialTuning,
  sharpBlend,
  sharpWeight,
  filteredBakeDensity,
  FILTER_BAKE_MAX_TEXELS,
  footprintMm,
  lruEvictions,
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
  it('çözünürlük sınırı: 1 yay dakikası × mesafe (40 cm 0.116 mm, 2 m 0.582 mm); Lup filtresiz', () => {
    expect(resolvableMm(VIEW_DISTANCE_MM.eye)).toBeCloseTo(0.1164, 3);
    expect(resolvableMm(VIEW_DISTANCE_MM.far)).toBeCloseTo(0.5818, 3);
    expect(filterSigmaMm('loupe')).toBe(0);
    expect(filterFwhmMm('loupe')).toBe(0);
  });
  it('Gauss σ = çözünürlük / 2.5 (Göz 0.0466 mm, Uzak 0.2327 mm); FWHM = 2.355·σ', () => {
    expect(filterSigmaMm('eye')).toBeCloseTo(0.1164 / 2.5, 4);
    expect(filterSigmaMm('far')).toBeCloseTo(0.5818 / 2.5, 4);
    expect(filterFwhmMm('eye')).toBeCloseTo(filterSigmaMm('eye') * 2.3548, 4);
    expect(sigmaFromFwhm(2.3548)).toBeCloseTo(1, 3);
  });
  it('MTF: sınır frekansında (1 / çözünürlük) %4 civarı söner; 0.5 mm örgü hücresi Gözde seçilir', () => {
    const mtf = (sigma: number, f: number) => Math.exp(-2 * Math.PI ** 2 * sigma ** 2 * f ** 2);
    const sEye = filterSigmaMm('eye');
    expect(mtf(sEye, 1 / resolvableMm(400))).toBeLessThan(0.05);
    expect(mtf(sEye, 1 / 0.5)).toBeGreaterThan(0.75); // 0.5 mm periyot
    expect(mtf(filterSigmaMm('far'), 1 / 2)).toBeGreaterThan(0.5); // Uzak'ta 2 mm'lik desen (dimi çizgisi) korunur
  });
  it('net çizime geçiş: σ_px ≤ 1.5 → 0 (filtreli), ≥ 4 → 1 (net), arada tek yönlü smoothstep', () => {
    expect(sharpBlend(0.5)).toBe(0);
    expect(sharpBlend(1.5)).toBe(0);
    expect(sharpBlend(4)).toBeCloseTo(1, 9);
    expect(sharpBlend(40)).toBe(1);
    let prev = 0;
    for (let px = 1.5; px <= 4; px += 0.1) {
      const w = sharpBlend(px);
      expect(w).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = w;
    }
    expect(sharpBlend(2.45)).toBeGreaterThan(0.4); // log-ortada ≈ 0.5
    expect(sharpBlend(2.45)).toBeLessThan(0.6);
  });
  it('zoom → net ağırlık: Göz 32 px/mm başlar, 86 px/mm tam net; Uzak 6.4 / 17 px/mm; Lup 0', () => {
    expect(sharpWeight('eye', 20)).toBe(0);
    expect(sharpWeight('eye', 32.2)).toBeLessThan(0.01);
    expect(sharpWeight('eye', 87)).toBeGreaterThan(0.99);
    expect(sharpWeight('far', 6)).toBe(0);
    expect(sharpWeight('far', 17.5)).toBeGreaterThan(0.99);
    expect(sharpWeight('loupe', 500)).toBe(0);
    // yakınlaştıkça bulanıklık artmaz: filtre σ'sı mm'de sabit, ağırlık zoom'la monoton artar
    expect(sharpWeight('eye', 60)).toBeGreaterThan(sharpWeight('eye', 45));
  });
  it('malzeme karakteri: Göz / Uzak varsayılanları, Lup etkilenmez, kullanıcı değeri kazanır', () => {
    expect(materialTuning('loupe', { relief: 1 })).toEqual({ relief: 1 });
    expect(materialTuning('eye', {}).relief).toBe(0.5);
    expect(materialTuning('far', { relief: 0.9 }).relief).toBe(0.9);
    expect(materialTuning('eye', undefined).spread).toBeGreaterThan(1);
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

describe('pişirme bellek bütçesi (siyah panel hatası)', () => {
  it('texel bütçesi: Tezgah 12 × 148 mm döşemesi 2.5 M texeli aşmaz; 64 texel/mm (7.3 M) bütçeyi aşardı', () => {
    const area = 12 * 148;
    expect(area * 64 * 64).toBeGreaterThan(FILTER_BAKE_MAX_TEXELS);
    const dFit = Math.sqrt(FILTER_BAKE_MAX_TEXELS / area);
    expect(area * dFit * dFit).toBeLessThanOrEqual(FILTER_BAKE_MAX_TEXELS + 1);
    expect(FILTER_BAKE_MAX_TEXELS * 50).toBeLessThan(160 * 1024 * 1024); // geçici bellek ≈ 50 bayt / texel
  });
  it('LRU tahliyesi: üst sınır aşılınca en eskiler gider, keep ve en az bir kayıt kalır', () => {
    const e = (id: string, mb: number) => ({ id, bytes: mb * 1024 * 1024 });
    expect(lruEvictions([e('a', 40), e('b', 40), e('c', 40)], 'c', 96 * 1024 * 1024)).toEqual(['a']);
    expect(lruEvictions([e('a', 40), e('b', 40), e('c', 40)], 'c', 50 * 1024 * 1024)).toEqual(['a', 'b']);
    expect(lruEvictions([e('a', 10), e('b', 10)], 'b', 96 * 1024 * 1024)).toEqual([]);
    // tek dev kayıt: sınırı aşsa da tahliye edilmez (görüntü hâlâ gerekli)
    expect(lruEvictions([e('a', 200)], 'a', 96 * 1024 * 1024)).toEqual([]);
    // keep eski olsa bile tahliye edilmez
    expect(lruEvictions([e('a', 60), e('b', 60)], 'a', 70 * 1024 * 1024)).toEqual(['b']);
  });
});

describe('ölçeğe bağlı otomatik geçiş (uzak görünüm ↔ gerçekçi lup)', () => {
  it('eşikler tek yerde: 6 px ve 12 px; büyüteç en az 14 px', () => {
    expect(REAL_BLEND_START_PX).toBe(6);
    expect(REAL_BLEND_END_PX).toBe(12);
    expect(MAGNIFIER_MIN_YARN_PX).toBeGreaterThan(REAL_BLEND_END_PX);
  });
  it('iplik çapı (px): < 6 uzak görünüm (0), > 12 tam lup (1), arada tek yönlü yumuşak geçiş', () => {
    expect(realBlend(0.5)).toBe(0);
    expect(realBlend(3)).toBe(0);
    expect(realBlend(6)).toBe(0);
    expect(realBlend(12)).toBe(1);
    expect(realBlend(40)).toBe(1);
    let prev = 0;
    for (let px = 6; px <= 12; px += 0.25) {
      const w = realBlend(px);
      expect(w).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = w;
    }
    // log ortada (≈ 8.5 px) yarı yarıya
    expect(realBlend(Math.sqrt(6 * 12))).toBeCloseTo(0.5, 6);
    // sıçrama yok: komşu 0.25 px'lik adımlar arasında fark küçük
    for (let px = 6; px < 12; px += 0.25) expect(realBlend(px + 0.25) - realBlend(px)).toBeLessThan(0.2);
  });
  it('ortalama çap desenden (iplik başına değil): çözgü ve atkı ortalamalarının ortalaması', () => {
    expect(meanDiameter([0.2, 0.2, 0.4], [0.3])).toBeCloseTo((0.8 / 3 + 0.3) / 2, 9);
    expect(meanDiameter([], [])).toBe(0);
  });
  it('her panel kendi px/mm\'sine göre bağımsız karar verir (Bendix ≈ 0.25 mm: 9 px/mm → 2.3 px uzak; 100 px/mm → 25 px lup)', () => {
    const d = 0.25;
    expect(realWeight(d, 2)).toBe(0);
    expect(realWeight(d, 9)).toBe(0); // 2.25 px
    expect(realWeight(d, 24)).toBe(0); // 6 px sınır
    expect(realWeight(d, 34)).toBeGreaterThan(0.3); // 8.5 px ≈ yarı
    expect(realWeight(d, 34)).toBeLessThan(0.7);
    expect(realWeight(d, 100)).toBe(1);
    // iki panel farklı px/mm ile farklı ağırlık alabilir
    expect(realWeight(d, 30)).toBeGreaterThan(realWeight(d, 26));
  });
  it('uzak görünümün filtresi: Göz / Uzak seçili olan, Lup modunda Göz', () => {
    expect(farFilterDistance('eye')).toBe('eye');
    expect(farFilterDistance('far')).toBe('far');
    expect(farFilterDistance('loupe')).toBe('eye');
  });
  it('filtre ekranda σ_px ≤ 1.5: yakınlaştıkça bulanıklık artmaz (zoom kovasında)', () => {
    const farFwhm = filterFwhmMm('far'); // 0.55 mm
    expect(cappedFwhmMm(farFwhm, 2)).toBeCloseTo(farFwhm, 9); // uzakta sınırsız
    const near = cappedFwhmMm(farFwhm, 64);
    expect(near).toBeLessThan(farFwhm);
    // σ_px = FWHM/2.355 × px/mm ≤ 1.5 (kova 2'nin kuvveti: 64 px/mm tam kova)
    expect((near / 2.3548) * 64).toBeLessThanOrEqual(FILTER_MAX_SIGMA_PX + 1e-3);
  });
});
