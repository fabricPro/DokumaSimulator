/**
 * FabricSpec JSON içe/dışa aktarma. v2 (slotlu) doğrudan okunur; v1 (renk dizili) JSON'lar
 * geriye uyumlu olarak v2'ye çevrilir.
 */
import { MAX_SLOTS, SLOT_NAMES, normalizeReedSpec, normalizeSystem, parseDenting, parseWeftReport, type FabricSpec, type YarnSlot, type YarnSystem } from '../render-engine';
import { colorsToSlots } from './slots';
import { parseRegulator } from '../render-engine/weft/regulator';
import { effectiveWeave } from '../render-engine/threading';

export interface ParsedFabric {
  spec: FabricSpec;
  warnings: string[];
  /** Eski biçimden çevrildi mi. */
  migrated: boolean;
}

function posNum(v: unknown, name: string): number {
  if (typeof v !== 'number' || !(v > 0)) throw new Error(`${name} pozitif sayı olmalı.`);
  return v;
}

function checkWeave(weave: unknown): boolean[][] {
  if (!Array.isArray(weave) || weave.length === 0 || !Array.isArray(weave[0]) || weave[0].length === 0) {
    throw new Error('weave boolean[][] olmalı.');
  }
  const w = weave[0].length;
  return weave.map((row: unknown, i: number) => {
    if (!Array.isArray(row) || row.length !== w) throw new Error(`weave satırı ${i} genişliği ${w} olmalı.`);
    return row.map((v) => v === true || v === 1);
  });
}

function checkSlots(v: unknown, name: string): YarnSlot[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_SLOTS) {
    throw new Error(`${name} 1–${MAX_SLOTS} slot içermeli.`);
  }
  return v.map((s: any, i: number) => {
    if (!s || typeof s !== 'object') throw new Error(`${name}[${i}] nesne olmalı.`);
    let system: YarnSystem;
    try {
      system = normalizeSystem(String(s.system));
    } catch {
      throw new Error(`${name}[${i}].system Ne/Nm/Dtex/Denier/Tex olmalı.`);
    }
    const slot: YarnSlot = {
      name: SLOT_NAMES[i],
      count: posNum(s.count, `${name}[${i}].count`),
      system,
      color: typeof s.color === 'string' ? s.color : '#808080',
      twist: s.twist === 'Z' ? 'Z' : 'S',
    };
    if (s.yarnDensity !== undefined) slot.yarnDensity = posNum(s.yarnDensity, `${name}[${i}].yarnDensity`);
    if (typeof s.yarnId === 'string') slot.yarnId = s.yarnId;
    return slot;
  });
}

function checkSequence(v: unknown, slots: number, name: string): number[] {
  if (!Array.isArray(v) || v.length === 0) throw new Error(`${name} boş olmayan dizi olmalı.`);
  return v.map((x, i) => {
    const n = typeof x === 'string' ? SLOT_NAMES.indexOf(x.toUpperCase() as any) : x;
    if (!Number.isInteger(n) || n < 0 || n >= slots) throw new Error(`${name}[${i}] geçersiz slot: ${x}`);
    return n as number;
  });
}

function pct(v: unknown, name: string): number {
  const n = v === undefined ? 0 : v;
  if (typeof n !== 'number' || n < 0 || n >= 100) throw new Error(`${name} 0–100 arası olmalı.`);
  return n;
}

export function validateSpecV2(raw: any): FabricSpec {
  const weave = checkWeave(raw.weave);
  const warpSlots = checkSlots(raw.warpSlots, 'warpSlots');
  const weftSlots = checkSlots(raw.weftSlots, 'weftSlots');
  const share = raw.warpCrimpShare ?? 0.4;
  if (typeof share !== 'number' || share < 0 || share > 1) throw new Error('warpCrimpShare 0–1 arası olmalı.');
  return {
    version: 2,
    weave,
    warpSlots,
    weftSlots,
    warpSequence: checkSequence(raw.warpSequence, warpSlots.length, 'warpSequence'),
    weftSequence: checkSequence(raw.weftSequence, weftSlots.length, 'weftSequence'),
    warpDensityLoom: posNum(raw.warpDensityLoom, 'warpDensityLoom'),
    weftDensityLoom: posNum(raw.weftDensityLoom, 'weftDensityLoom'),
    warpShrinkPct: pct(raw.warpShrinkPct, 'warpShrinkPct'),
    weftShrinkPct: pct(raw.weftShrinkPct, 'weftShrinkPct'),
    warpCrimpShare: share,
    ...checkReed(raw.reed),
    ...(raw.relax && typeof raw.relax === 'object'
      ? {
          relax: {
            ...(raw.relax.c > 0 ? { c: raw.relax.c } : {}),
            ...(raw.relax.rho >= 1 ? { rho: raw.relax.rho } : {}),
            ...(raw.relax.rhoWeft >= 1 ? { rhoWeft: raw.relax.rhoWeft } : {}),
          },
        }
      : {}),
    ...checkWeftReport(raw.weftDensityReport),
    ...checkRegulator(raw.weftRegulator),
    ...(Array.isArray(raw.yarns) ? { yarns: raw.yarns } : {}),
    ...checkThreading(raw, weave),
  };
}

/**
 * Tahar + armür (isteğe bağlı): ikisi birlikte verilmeli; weave bunlardan türetilmiş olmalı (değilse türetilen
 * kullanılır — tahar / armür kaynak sayılır). Eski dosyalarda alan yok → düz tahar.
 */
function checkThreading(raw: any, weave: boolean[][]): Partial<FabricSpec> {
  if (raw.threading === undefined && raw.liftplan === undefined) return {};
  if (!Array.isArray(raw.threading) || raw.threading.length === 0) throw new Error('threading boş olmayan dizi olmalı.');
  if (!Array.isArray(raw.liftplan) || raw.liftplan.length === 0) throw new Error('threading ile birlikte liftplan (armür) gerekli.');
  const threading = raw.threading.map((f: unknown, i: number) => {
    if (!Number.isInteger(f) || (f as number) < 0 || (f as number) > 63) throw new Error(`threading[${i}] 0–63 arası tamsayı olmalı.`);
    return f as number;
  });
  const F = Math.max(Math.max(...threading) + 1, Number.isInteger(raw.frames) ? raw.frames : 0);
  const liftplan = raw.liftplan.map((row: unknown, j: number) => {
    if (!Array.isArray(row)) throw new Error(`liftplan satırı ${j} dizi olmalı.`);
    return Array.from({ length: F }, (_, f) => row[f] === true || row[f] === 1);
  });
  void weave;
  return { threading, liftplan, frames: F, weave: effectiveWeave(threading, liftplan) };
}

/** Atkı regülatörü raporu ('N' / 'R' dizisi ya da "N R R" metni): yoksa regülatör yok (eski dosyalar). */
function checkRegulator(raw: unknown): { weftRegulator?: Array<'N' | 'R'> } {
  if (raw === undefined || raw === null) return {};
  const r = parseRegulator(Array.isArray(raw) ? raw.join(' ') : String(raw));
  if (!r.ok) throw new Error('weftRegulator geçersiz: ' + r.error);
  return { weftRegulator: r.report };
}

/** Atkı sıklık raporu: yoksa eşit adım. */
function checkWeftReport(raw: unknown): { weftDensityReport?: number[] } {
  if (raw === undefined || raw === null) return {};
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('weftDensityReport boş olmayan dizi olmalı.');
  const r = parseWeftReport(raw.join('-'));
  if (!r.ok) throw new Error('weftDensityReport geçersiz: ' + r.error);
  return { weftDensityReport: r.report };
}

/** Tarak alanı: yoksa tarak yok; eski { densityPerCm, denting } biçimi yeniye çevrilir. */
function checkReed(raw: unknown): { reed?: FabricSpec['reed'] } {
  if (raw === undefined || raw === null) return {};
  const reed = normalizeReedSpec(raw);
  if (!reed) throw new Error('reed alanı tanınmadı: { reedNumber, dentingReport } bekleniyor.');
  if (!(reed.reedNumber > 0)) throw new Error('reed.reedNumber pozitif olmalı.');
  const check = parseDenting(reed.dentingReport.join('-'));
  if (!check.ok) throw new Error('reed.dentingReport geçersiz: ' + check.error);
  if (reed.wireRatio !== undefined && !(reed.wireRatio >= 0 && reed.wireRatio < 0.95)) {
    throw new Error('reed.wireRatio 0–0.95 arası olmalı.');
  }
  return { reed };
}

/** v1 JSON (warpColors/weftColors, warpYarn/weftYarn, warpDensity/weftDensity) → v2. */
export function migrateV1(raw: any): { spec: FabricSpec; warnings: string[] } {
  const weave = checkWeave(raw.weave);
  const yarn = (y: any, name: string) => {
    if (!y || typeof y !== 'object') throw new Error(`${name} eksik.`);
    let system: YarnSystem;
    try {
      system = normalizeSystem(String(y.system));
    } catch {
      throw new Error(`${name}.system Ne/Nm/Dtex/Denier/Tex olmalı.`);
    }
    return { count: posNum(y.count, `${name}.count`), system };
  };
  const colors = (v: unknown, name: string) => {
    if (!Array.isArray(v) || v.length === 0 || !v.every((c) => typeof c === 'string')) {
      throw new Error(`${name} boş olmayan renk dizisi olmalı.`);
    }
    return v as string[];
  };
  const w = colorsToSlots(colors(raw.warpColors, 'warpColors'), yarn(raw.warpYarn, 'warpYarn'), 'Çözgü');
  const f = colorsToSlots(colors(raw.weftColors, 'weftColors'), yarn(raw.weftYarn, 'weftYarn'), 'Atkı');
  const warnings = [...w.warnings, ...f.warnings];
  if (raw.warpYarn?.fiberDensity || raw.weftYarn?.fiberDensity) {
    warnings.push('Eski lif yoğunluğu (fiberDensity) yeni modelde iplik hacim yoğunluğu değil; varsayılan 0.85 kullanıldı.');
  }
  return {
    spec: {
      version: 2,
      weave,
      warpSlots: w.slots,
      weftSlots: f.slots,
      warpSequence: w.sequence,
      weftSequence: f.sequence,
      warpDensityLoom: posNum(raw.warpDensity, 'warpDensity'),
      weftDensityLoom: posNum(raw.weftDensity, 'weftDensity'),
      warpShrinkPct: 0,
      weftShrinkPct: 0,
      warpCrimpShare: 0.4,
    },
    warnings,
  };
}

/** JSON metnini doğrulanmış v2 FabricSpec'e çevirir (v1 ise göç ettirir). */
export function parseFabricJson(text: string): ParsedFabric {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error('Geçersiz JSON: ' + (e as Error).message);
  }
  if (!raw || typeof raw !== 'object') throw new Error('JSON bir nesne olmalı.');
  if (raw.version === 2 || Array.isArray(raw.warpSlots)) {
    return { spec: validateSpecV2(raw), warnings: [], migrated: false };
  }
  const { spec, warnings } = migrateV1(raw);
  return { spec, warnings, migrated: true };
}

export function serializeFabricJson(spec: FabricSpec): string {
  return JSON.stringify(spec, null, 2);
}
