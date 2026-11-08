/**
 * WIF (Weaving Information File) içe aktarıcı.
 * THREADING + TIEUP + TREADLING veya THREADING + LIFTPLAN'dan örgü matrisini türetir;
 * COLOR TABLE varsa çözgü/atkı renklerini alır.
 */

export interface WifResult {
  /** Satır = atkı (0 = ilk atkı, en altta), sütun = çözgü; true = çözgü üstte. */
  weave: boolean[][];
  warpColors?: string[];
  weftColors?: string[];
  warnings: string[];
}

type Section = Map<string, string>;

/** INI biçimini bölüm → (anahtar → değer) haritasına çevirir. Anahtar ve bölüm adları küçük harfe indirilir. */
export function parseIni(text: string): Map<string, Section> {
  const sections = new Map<string, Section>();
  let current: Section | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^﻿/, '').trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) {
      const name = sec[1].trim().toLowerCase();
      current = sections.get(name) ?? new Map();
      sections.set(name, current);
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 0 || !current) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const value = line.slice(eq + 1).split(';')[0].trim();
    current.set(key, value);
  }
  return sections;
}

function intList(value: string | undefined): number[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function indexedLists(sec: Section | undefined): Map<number, number[]> {
  const out = new Map<number, number[]>();
  if (!sec) return out;
  for (const [k, v] of sec) {
    const idx = parseInt(k, 10);
    if (Number.isFinite(idx) && idx > 0) out.set(idx, intList(v));
  }
  return out;
}

function maxKey(m: Map<number, unknown>): number {
  let max = 0;
  for (const k of m.keys()) if (k > max) max = k;
  return max;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const v = value.toLowerCase();
  if (['true', 'yes', 'on', '1'].includes(v)) return true;
  if (['false', 'no', 'off', '0'].includes(v)) return false;
  return fallback;
}

function hex2(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}

export function parseWif(text: string): WifResult {
  const s = parseIni(text);
  const warnings: string[] = [];
  if (!s.has('wif')) warnings.push('[WIF] bölümü yok; dosya yine de okunmaya çalışıldı.');

  const threading = indexedLists(s.get('threading'));
  if (threading.size === 0) throw new Error('WIF: THREADING bölümü bulunamadı veya boş.');

  const liftplan = indexedLists(s.get('liftplan'));
  const treadling = indexedLists(s.get('treadling'));
  const tieup = indexedLists(s.get('tieup'));

  let picks: Map<number, number[]>; // atkı → kalkan çerçeveler
  if (liftplan.size > 0) {
    picks = liftplan;
  } else if (treadling.size > 0) {
    if (tieup.size === 0) throw new Error('WIF: TREADLING var ama TIEUP bölümü yok.');
    picks = new Map();
    for (const [pick, treadles] of treadling) {
      const shafts = new Set<number>();
      for (const t of treadles) for (const sh of tieup.get(t) ?? []) shafts.add(sh);
      picks.set(pick, [...shafts]);
    }
  } else {
    throw new Error('WIF: LIFTPLAN veya TREADLING bölümü bulunamadı.');
  }

  const warpSec = s.get('warp');
  const weftSec = s.get('weft');
  const ends = Math.max(parseInt(warpSec?.get('threads') ?? '0', 10) || 0, maxKey(threading));
  const pickCount = Math.max(parseInt(weftSec?.get('threads') ?? '0', 10) || 0, maxKey(picks));
  if (ends === 0 || pickCount === 0) throw new Error('WIF: çözgü veya atkı sayısı 0.');

  const rising = bool(s.get('weaving')?.get('rising shed'), true);

  const weave: boolean[][] = [];
  for (let p = 1; p <= pickCount; p++) {
    const lifted = new Set(picks.get(p) ?? []);
    const row: boolean[] = [];
    for (let e = 1; e <= ends; e++) {
      const shafts = threading.get(e) ?? [];
      const up = shafts.some((sh) => lifted.has(sh));
      row.push(rising ? up : !up);
    }
    weave.push(row);
  }

  // Renkler
  const result: WifResult = { weave, warnings };
  const table = s.get('color table');
  if (table && table.size > 0) {
    const rangeRaw = intListAllowZero(s.get('color palette')?.get('range'));
    const lo = rangeRaw.length === 2 ? rangeRaw[0] : 0;
    const hi = rangeRaw.length === 2 ? rangeRaw[1] : 255;
    const scale = (v: number) => ((v - lo) / Math.max(1, hi - lo)) * 255;
    const palette = new Map<number, string>();
    for (const [k, v] of table) {
      const idx = parseInt(k, 10);
      const rgb = intListAllowZero(v);
      if (Number.isFinite(idx) && rgb.length >= 3) {
        palette.set(idx, '#' + rgb.slice(0, 3).map((c) => hex2(scale(c))).join(''));
      }
    }
    const colorsFor = (count: number, sectionName: string, defaultIdx: string | undefined) => {
      const per = s.get(sectionName);
      const def = defaultIdx ? palette.get(parseInt(defaultIdx, 10)) : undefined;
      if (!per && !def) return undefined;
      const out: string[] = [];
      for (let i = 1; i <= count; i++) {
        const idx = per?.get(String(i));
        const col = idx ? palette.get(parseInt(idx, 10)) : undefined;
        out.push(col ?? def ?? '#808080');
      }
      return out;
    };
    result.warpColors = colorsFor(ends, 'warp colors', warpSec?.get('color'));
    result.weftColors = colorsFor(pickCount, 'weft colors', weftSec?.get('color'));
  }
  return result;
}

function intListAllowZero(value: string | undefined): number[] {
  if (!value) return [];
  return value
    .split(',')
    .map((x) => parseInt(x.trim(), 10))
    .filter((n) => Number.isFinite(n));
}
