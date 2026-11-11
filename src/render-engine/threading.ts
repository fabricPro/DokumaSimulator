/**
 * Tel bazlı çözgü modeli: tahar (tel → çerçeve) + armür (atkı × çerçeve) → bağlantı.
 *
 * Her çözgü teli için üç bağımsız dizi, hepsi tel indeksine göre, her biri kendi raporuyla:
 *  - çerçeve: `FabricSpec.threading` (tahar, T tel);
 *  - iplik slotu: `FabricSpec.warpSequence` (A A B …);
 *  - diş: `FabricSpec.reed.dentingReport` (taraklama).
 * Çözgü raporu bunların EKOK'udur (render-engine zaten lcm(örgü genişliği, dizi, tarak) alır; tahar varken örgü
 * genişliği = T).
 *
 * Bağlantı: üstte(i, j) = armür[j][tahar[i]]. Tahar + armür varsa `FabricSpec.weave` bundan TÜRETİLİR
 * (`effectiveWeave`) ve tüm motorlar (klasik, gerçekçi, metrik, çekme) yalnız `weave`'i okur → karışık tahar +
 * armür ile düz tahar + karşılık gelen örgü matrisi birebir aynı sonucu verir. Tahar yoksa mevcut örgü "düz tahar"
 * olarak yorumlanır: tahar[i] = i mod örgü genişliği, armür = örgü.
 */
import type { FabricSpec } from './types';
import { lcm } from './physical/positions';

export type ThreadingTemplate = 'straight' | 'pointed' | 'broken' | 'mixed';
export const THREADING_TEMPLATES: Array<[ThreadingTemplate, string]> = [
  ['straight', 'Düz'],
  ['pointed', 'Sivri'],
  ['broken', 'Kırık'],
  ['mixed', 'Karışık'],
];


/** Tahar şablonu (0 tabanlı çerçeve indeksleri). */
export function threadingTemplate(kind: ThreadingTemplate, frames: number): number[] {
  const n = Math.max(1, Math.floor(frames));
  const up = Array.from({ length: n }, (_, k) => k);
  switch (kind) {
    case 'straight':
      return up;
    case 'pointed':
      // 1-2-…-n-…-2 (sivri / zikzak)
      return n <= 2 ? up : [...up, ...up.slice(1, n - 1).reverse()];
    case 'broken': {
      // 1-2-…-n, sonra ikili ters: 2-1-4-3-… (kırık dimi taharı)
      const tail: number[] = [];
      for (let k = 0; k + 1 < n; k += 2) tail.push(k + 1, k);
      if (n % 2 === 1) tail.push(n - 1);
      return [...up, ...tail];
    }
    case 'mixed':
      // tek çerçeveler sonra çift çerçeveler: 1-3-5-7-2-4-6-8
      return [...up.filter((k) => k % 2 === 0), ...up.filter((k) => k % 2 === 1)];
  }
}

/** tahar × armür → örgü matrisi [atkı][tel] (genişlik T, yükseklik armür satırı). */
export function effectiveWeave(threading: number[], liftplan: boolean[][]): boolean[][] {
  return liftplan.map((row) => threading.map((f) => !!row[f]));
}

/** Spec'in tahar + armürü varsa ondan, yoksa kendi örgü matrisi. */
export function specWeave(spec: Pick<FabricSpec, 'weave' | 'threading' | 'liftplan'>): boolean[][] {
  return spec.threading && spec.liftplan ? effectiveWeave(spec.threading, spec.liftplan) : spec.weave;
}

/** Düz tahar yorumu: tahar[i] = i mod genişlik, armür = örgü (çerçeve sayısı = örgü genişliği). */
export function straightOf(weave: boolean[][]): { threading: number[]; liftplan: boolean[][]; frames: number } {
  const W = weave[0].length;
  return { threading: Array.from({ length: W }, (_, i) => i), liftplan: weave.map((r) => [...r]), frames: W };
}

/**
 * Örgü matrisinden en az çerçeveli tahar + armür: eşit sütunlar aynı çerçeveye (ilk görülme sırasıyla).
 * Düz tahar için (tüm sütunlar farklı) tahar = 0..W−1 ve armür = örgü.
 */
export function weaveToThreading(weave: boolean[][]): { threading: number[]; liftplan: boolean[][]; frames: number } {
  const W = weave[0].length;
  const keys: string[] = [];
  const threading: number[] = [];
  for (let i = 0; i < W; i++) {
    const key = weave.map((r) => (r[i] ? '1' : '0')).join('');
    let f = keys.indexOf(key);
    if (f < 0) {
      f = keys.length;
      keys.push(key);
    }
    threading.push(f);
  }
  const liftplan = weave.map((_, j) => keys.map((k) => k[j] === '1'));
  return { threading, liftplan, frames: keys.length };
}

/** Tahar / armür değişince spec'i günceller: weave türetilir, çerçeve sayısı en az kullanılan + 1. */
export function withThreading(spec: FabricSpec, threading: number[], liftplan: boolean[][], frames?: number): FabricSpec {
  const used = Math.max(0, ...threading) + 1;
  const F = Math.max(used, frames ?? spec.frames ?? used, liftplan[0]?.length ?? 0);
  const lp = liftplan.map((r) => Array.from({ length: F }, (_, f) => !!r[f]));
  return { ...spec, threading: [...threading], liftplan: lp, frames: F, weave: effectiveWeave(threading, lp) };
}

/** Taharı kaldırır (örgü matrisi kalır = düz tahar yorumu). */
export function withoutThreading(spec: FabricSpec): FabricSpec {
  const { threading: _t, liftplan: _l, frames: _f, ...rest } = spec;
  return { ...rest, weave: specWeave(spec).map((r) => [...r]) };
}

/** En kısa tekrar eden periyoda indirger (ör. [0,1,0,1] → [0,1]). */
export function minimalPeriod<T>(seq: T[]): T[] {
  const n = seq.length;
  for (let p = 1; p <= n; p++) {
    if (n % p !== 0) continue;
    let ok = true;
    for (let i = p; i < n && ok; i++) if (seq[i] !== seq[i - p]) ok = false;
    if (ok) return seq.slice(0, p);
  }
  return seq;
}

/** Tahar ile iplik dizisinin ortak raporu (tel). */
export function warpThreadRepeat(spec: Pick<FabricSpec, 'weave' | 'threading' | 'warpSequence'>): number {
  const T = spec.threading?.length ?? spec.weave[0].length;
  return lcm(T, Math.max(1, spec.warpSequence.length));
}

export interface FrameSlotRange {
  /** Çerçeve aralığı, 0 tabanlı, uçlar dahil. */
  from: number;
  to: number;
  slot: number;
}

/**
 * "Çerçeveye iplik ata": tahara bakıp ilgili tellerin iplik slotunu doldurur. Kayıt tel bazındadır: dizi önce
 * lcm(T, dizi) uzunluğuna açılır, atanır, sonra en kısa periyoda indirgenir.
 */
export function assignSlotsByFrames(threading: number[], sequence: number[], ranges: FrameSlotRange[]): number[] {
  const seq = sequence.length ? sequence : [0];
  const L = lcm(threading.length, seq.length);
  const out: number[] = [];
  for (let i = 0; i < L; i++) {
    const f = threading[i % threading.length];
    let s = seq[i % seq.length];
    for (const r of ranges) if (f >= Math.min(r.from, r.to) && f <= Math.max(r.from, r.to)) s = r.slot;
    out.push(s);
  }
  return minimalPeriod(out);
}

/** Ters görünüm: her çerçevede bulunan iplik slotları (artan). */
export function slotsPerFrame(threading: number[], sequence: number[], frames: number): number[][] {
  const seq = sequence.length ? sequence : [0];
  const L = lcm(threading.length, seq.length);
  const sets = Array.from({ length: frames }, () => new Set<number>());
  for (let i = 0; i < L; i++) {
    const f = threading[i % threading.length];
    if (f < frames) sets[f].add(seq[i % seq.length]);
  }
  return sets.map((s) => [...s].sort((a, b) => a - b));
}
