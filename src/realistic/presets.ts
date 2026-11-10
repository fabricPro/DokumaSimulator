/**
 * Kalibrasyon preset'leri (saf, testli). Bir preset, bir iplik tipinin yüzey ayarlarını (parlaklık,
 * tüylülük, büküm) ve gerçek numune fotoğrafıyla eşleştirilmiş görünüm ayarlarını (ışık, AO, speküler,
 * düzensizlik) taşır. JSON olarak indirilir / yüklenir.
 */
import type { CountUnit, FabricInput, Luster, Quality, Tuning, ViewParams } from './types';
import { DEFAULT_PACKING, PACK_KINDS, type PackingParams } from './packing';

export interface YarnSurface {
  luster: Luster;
  hairiness: number;
  twistPerM?: number;
}

export interface RealisticPreset {
  version: 1;
  name: string;
  /** Hangi iplik tipine ait (numara + birim ile eşleşir). */
  yarn: { count: number; unit: CountUnit };
  surface: YarnSurface;
  light: { azimuthDeg: number; elevationDeg: number };
  tuning: Required<Pick<Tuning, 'aoStrength' | 'specularStrength' | 'specularWidth' | 'hairiness' | 'irregularity'>>;
  quality?: Quality;
  /** Kalibrasyonda kullanılan fotoğraf ölçeği (bilgi amaçlı). */
  photoPxPerCm?: number;
  /** Paketleme parametreleri (tip başına en/boy + doldurma oranı, sıkışma; packing.ts). Yoksa varsayılan. */
  packing?: PackingParams;
  note?: string;
}

export const DEFAULT_TUNING: RealisticPreset['tuning'] = {
  aoStrength: 1,
  specularStrength: 1,
  specularWidth: 1,
  hairiness: 1,
  irregularity: 1,
};

const UNITS: CountUnit[] = ['Ne', 'Nm', 'Dtex', 'Denier', 'Tex'];
const LUSTERS: Luster[] = ['mat', 'yarimat', 'parlak'];

function num(v: unknown, name: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
    throw new Error(`${name} ${min}–${max} arası sayı olmalı.`);
  }
  return v;
}

/** JSON metni → doğrulanmış preset. Hatalı alanlarda Türkçe hata. */
export function parsePreset(text: string): RealisticPreset {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error('Geçersiz JSON: ' + (e as Error).message);
  }
  if (!raw || typeof raw !== 'object') throw new Error('Preset bir nesne olmalı.');
  if (raw.version !== 1) throw new Error('Desteklenmeyen preset sürümü (version: 1 bekleniyor).');
  if (typeof raw.name !== 'string' || raw.name.trim() === '') throw new Error('Preset adı gerekli.');
  if (!raw.yarn || !UNITS.includes(raw.yarn.unit)) throw new Error(`yarn.unit ${UNITS.join('/')} olmalı.`);
  if (!raw.surface || !LUSTERS.includes(raw.surface.luster)) throw new Error(`surface.luster ${LUSTERS.join('/')} olmalı.`);
  const t = { ...DEFAULT_TUNING, ...(raw.tuning ?? {}) };
  const preset: RealisticPreset = {
    version: 1,
    name: raw.name.trim(),
    yarn: { count: num(raw.yarn.count, 'yarn.count', 0.01, 1e6), unit: raw.yarn.unit },
    surface: {
      luster: raw.surface.luster,
      hairiness: num(raw.surface.hairiness, 'surface.hairiness', 0, 1),
      ...(raw.surface.twistPerM !== undefined ? { twistPerM: num(raw.surface.twistPerM, 'surface.twistPerM', 0, 5000) } : {}),
    },
    light: {
      azimuthDeg: num(raw.light?.azimuthDeg, 'light.azimuthDeg', -360, 360),
      elevationDeg: num(raw.light?.elevationDeg, 'light.elevationDeg', 1, 90),
    },
    tuning: {
      aoStrength: num(t.aoStrength, 'tuning.aoStrength', 0, 4),
      specularStrength: num(t.specularStrength, 'tuning.specularStrength', 0, 10),
      specularWidth: num(t.specularWidth, 'tuning.specularWidth', 0.05, 10),
      hairiness: num(t.hairiness, 'tuning.hairiness', 0, 5),
      irregularity: num(t.irregularity, 'tuning.irregularity', 0, 10),
    },
  };
  if (raw.quality !== undefined) {
    if (!['low', 'medium', 'high'].includes(raw.quality)) throw new Error('quality low/medium/high olmalı.');
    preset.quality = raw.quality;
  }
  if (raw.photoPxPerCm !== undefined) preset.photoPxPerCm = num(raw.photoPxPerCm, 'photoPxPerCm', 1, 1e6);
  if (raw.packing !== undefined) preset.packing = parsePacking(raw.packing);
  if (typeof raw.note === 'string') preset.note = raw.note;
  return preset;
}

/** Paketleme bölümü: eksik tipler varsayılanla tamamlanır. */
export function parsePacking(raw: any): PackingParams {
  if (!raw || typeof raw !== 'object') throw new Error('packing bir nesne olmalı.');
  const kinds = {} as PackingParams['kinds'];
  for (const k of PACK_KINDS) {
    const r = raw.kinds?.[k] ?? {};
    const d = DEFAULT_PACKING.kinds[k];
    kinds[k] = {
      maxAspect: num(r.maxAspect ?? d.maxAspect, `packing.kinds.${k}.maxAspect`, 1, 8),
      fill: num(r.fill ?? d.fill, `packing.kinds.${k}.fill`, 0.2, 1),
    };
  }
  return { kinds, compression: num(raw.compression ?? DEFAULT_PACKING.compression, 'packing.compression', 0.3, 1) };
}

export function serializePreset(p: RealisticPreset): string {
  return JSON.stringify(p, null, 2);
}

/** Bir girdideki iplik tipinin indeksini numara + birimle bulur (yoksa −1). */
export function findYarnType(input: FabricInput, yarn: RealisticPreset['yarn']): number {
  return input.yarnTypes.findIndex((y) => y.unit === yarn.unit && Math.abs(y.count - yarn.count) < 1e-9);
}

/** Aynı numara + birimdeki tüm iplik tipleri (ör. çözgü ve atkıda aynı iplik). */
export function matchingYarnTypes(input: FabricInput, yarn: RealisticPreset['yarn']): number[] {
  const out: number[] = [];
  input.yarnTypes.forEach((y, i) => {
    if (y.unit === yarn.unit && Math.abs(y.count - yarn.count) < 1e-9) out.push(i);
  });
  return out;
}

/** İplik tipi indeksine göre yüzey ayarlarını uygular (yeni girdi döner; girdi değişmez). */
export function applySurfaces(input: FabricInput, overrides: Record<number, YarnSurface>): FabricInput {
  const keys = Object.keys(overrides);
  if (keys.length === 0) return input;
  return {
    ...input,
    yarnTypes: input.yarnTypes.map((y, i) => {
      const o = overrides[i];
      if (!o) return y;
      return { ...y, luster: o.luster, hairiness: o.hairiness, ...(o.twistPerM !== undefined ? { twistPerM: o.twistPerM } : {}) };
    }),
  };
}

/** Preset'i görünüm ayarlarına uygular. */
export function applyPresetToView(view: ViewParams, p: RealisticPreset): ViewParams {
  return {
    ...view,
    light: { ...p.light },
    quality: p.quality ?? view.quality,
    tuning: { ...(view.tuning ?? {}), ...p.tuning },
  };
}
