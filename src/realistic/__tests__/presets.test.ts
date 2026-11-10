import { describe, expect, it } from 'vitest';
import { applyPresetToView, applySurfaces, DEFAULT_TUNING, findYarnType, parsePreset, serializePreset, type RealisticPreset } from '../presets';
import { matchingYarnTypes } from '../presets';
import { photoRect, scaleFromPoints, simView, zoomAt } from '../calibration';
import { inputFromRows } from '../fixtures';
import { plain } from '../../presets/weaves';
import type { ViewParams } from '../types';

const preset: RealisticPreset = {
  version: 1,
  name: 'Pamuk Ne 20 — numune A',
  yarn: { count: 20, unit: 'Ne' },
  surface: { luster: 'mat', hairiness: 0.45, twistPerM: 760 },
  light: { azimuthDeg: 120, elevationDeg: 38 },
  tuning: { aoStrength: 1.3, specularStrength: 0.7, specularWidth: 1.4, hairiness: 1.2, irregularity: 1.5 },
  quality: 'high',
  photoPxPerCm: 1180,
};

describe('preset JSON', () => {
  it('gidiş-dönüş', () => {
    expect(parsePreset(serializePreset(preset))).toEqual(preset);
  });
  it('eksik tuning varsayılanla dolar', () => {
    const p = parsePreset(JSON.stringify({ ...preset, tuning: { aoStrength: 2 } }));
    expect(p.tuning).toEqual({ ...DEFAULT_TUNING, aoStrength: 2 });
  });
  it('hatalı alanlar Türkçe hata verir', () => {
    expect(() => parsePreset('{')).toThrow(/JSON/);
    expect(() => parsePreset(JSON.stringify({ ...preset, version: 2 }))).toThrow(/sürüm/);
    expect(() => parsePreset(JSON.stringify({ ...preset, surface: { luster: 'cok', hairiness: 0 } }))).toThrow(/luster/);
    expect(() => parsePreset(JSON.stringify({ ...preset, surface: { luster: 'mat', hairiness: 3 } }))).toThrow(/hairiness/);
    expect(() => parsePreset(JSON.stringify({ ...preset, light: { azimuthDeg: 0, elevationDeg: 0 } }))).toThrow(/elevation/);
    expect(() => parsePreset(JSON.stringify({ ...preset, yarn: { count: 20, unit: 'tex' } }))).toThrow(/unit/);
  });
});

describe('uygulama', () => {
  const inp = inputFromRows(plain(), '#ffffff', '#000000');
  it('iplik tipi numara + birimle bulunur', () => {
    expect(findYarnType(inp, { count: 20, unit: 'Ne' })).toBe(0);
    expect(findYarnType(inp, { count: 150, unit: 'Denier' })).toBe(1);
    expect(findYarnType(inp, { count: 30, unit: 'Ne' })).toBe(-1);
  });
  it('yüzey ayarı yalnız seçilen tipe uygulanır, girdi değişmez', () => {
    const out = applySurfaces(inp, { 0: preset.surface });
    expect(out.yarnTypes[0]).toMatchObject({ luster: 'mat', hairiness: 0.45, twistPerM: 760 });
    expect(out.yarnTypes[1]).toEqual(inp.yarnTypes[1]);
    expect(inp.yarnTypes[0].hairiness).toBe(0.3);
    expect(applySurfaces(inp, {})).toBe(inp);
  });
  it('görünüm ayarları preset\'ten gelir', () => {
    const v: ViewParams = { pxPerCm: 500, offsetCm: [0, 0], light: { azimuthDeg: 0, elevationDeg: 60 }, quality: 'low' };
    const out = applyPresetToView(v, preset);
    expect(out.light).toEqual(preset.light);
    expect(out.quality).toBe('high');
    expect(out.tuning).toMatchObject(preset.tuning);
    expect(out.pxPerCm).toBe(500);
  });
});

describe('kalibrasyon ölçeği ve ortak görünüm', () => {
  it('iki nokta → px/cm', () => {
    expect(scaleFromPoints({ x: 10, y: 20 }, { x: 310, y: 420 }, 1)).toBeCloseTo(500, 12);
    expect(scaleFromPoints({ x: 0, y: 0 }, { x: 600, y: 0 }, 2)).toBeCloseTo(300, 12);
    expect(() => scaleFromPoints({ x: 0, y: 0 }, { x: 1, y: 0 }, 1)).toThrow(/yakın/);
    expect(() => scaleFromPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 0)).toThrow();
  });
  const v = { screenPxPerCm: 400, x0Cm: 0.25, y0Cm: 0.5, simShiftCm: [0, 0] as [number, number] };
  it('fotoğraf ve simülasyon aynı ekran ölçeğinde (1 cm = aynı px)', () => {
    const r = photoRect(v, { width: 2400, height: 1800, pxPerCm: 1200 });
    expect(r.width).toBeCloseTo(800, 9); // 2 cm × 400 px/cm
    expect(r.left).toBeCloseTo(-100, 9);
    expect(r.top).toBeCloseTo(-200, 9);
    const sv = simView(v, 300, 2, { light: { azimuthDeg: 0, elevationDeg: 45 }, quality: 'low' });
    expect(sv.pxPerCm).toBe(800); // cihaz pikseli
    expect(sv.offsetCm[0]).toBeCloseTo(0.25, 12);
    expect(sv.offsetCm[1]).toBeCloseTo(-(0.5 + 300 / 400), 12); // y işaret değiştirir
  });
  it('simülasyon kayması yalnız simülasyonu oynatır', () => {
    const sv = simView({ ...v, simShiftCm: [0.1, 0.05] }, 300, 1, { light: { azimuthDeg: 0, elevationDeg: 45 }, quality: 'low' });
    expect(sv.offsetCm[0]).toBeCloseTo(0.15, 12);
    expect(sv.offsetCm[1]).toBeCloseTo(-(0.45 + 0.75), 12);
  });
  it('imleç etrafında yakınlaştırma noktayı sabit tutar', () => {
    const z = zoomAt(v, { x: 120, y: 80 }, 2, 10, 5000);
    expect(z.screenPxPerCm).toBe(800);
    expect(z.x0Cm + 120 / 800).toBeCloseTo(v.x0Cm + 120 / 400, 12);
    expect(z.y0Cm + 80 / 800).toBeCloseTo(v.y0Cm + 80 / 400, 12);
    expect(zoomAt(v, { x: 0, y: 0 }, 100, 10, 5000).screenPxPerCm).toBe(5000);
  });
  it('aynı numaralı tüm iplik tipleri eşleşir', () => {
    const inp = inputFromRows(plain(), '#ffffff', '#000000');
    const twin = { ...inp, yarnTypes: [inp.yarnTypes[0], inp.yarnTypes[1], { ...inp.yarnTypes[0] }] };
    expect(matchingYarnTypes(twin, { count: 20, unit: 'Ne' })).toEqual([0, 2]);
  });
});
