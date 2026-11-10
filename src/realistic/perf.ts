/**
 * Faz 6: otomatik kalite (saf, testli). Ölçülen kare süresine göre bir basamak merdiveninde iner / çıkar.
 *
 * Merdiven: önce AO / gölge örnekleri düşer (görüntü keskin kalır), sonra çözünürlük (CSS'te büyütülür).
 * Histerezis: bütçeyi aşınca bir basamak iner; bütçenin yarısının altında kalınca bir basamak çıkar.
 * Arada sabit kalır, böylece iki basamak arasında titreşmez. Süre üstel ortalama ile yumuşatılır.
 *
 * VARSAYIM (telefonda ölçülecek): 16 ms bütçe 1024² pencere için; orta telefonda 'low' + 1.0 ölçeğin
 * bütçeye sığması beklenir. Masaüstü ölçümleri samples/realistic/phase6/perf.json'da.
 */
import type { Quality } from './types';

export interface PerfLevel {
  quality: Quality;
  /** Render çözünürlüğü / CSS çözünürlüğü (cihaz pikseli oranı bunun üzerine çarpılır). */
  scale: number;
}

export const PERF_LADDER: readonly PerfLevel[] = [
  { quality: 'high', scale: 1 },
  { quality: 'medium', scale: 1 },
  { quality: 'low', scale: 1 },
  { quality: 'low', scale: 0.75 },
  { quality: 'low', scale: 0.5 },
];

export const FRAME_BUDGET_MS = 16;

export interface AutoQualityState {
  level: number;
  /** Yumuşatılmış kare süresi (ms); ilk ölçümden önce null. */
  avgMs: number | null;
}

export function initialAutoQuality(level = 0): AutoQualityState {
  return { level: Math.max(0, Math.min(PERF_LADDER.length - 1, level)), avgMs: null };
}

/**
 * Yeni ölçümle durumu günceller. Basamak değişince ortalama sıfırlanır (yeni basamağın süresi farklıdır).
 * `alpha` üstel ortalama ağırlığı.
 */
export function stepAutoQuality(s: AutoQualityState, frameMs: number, budgetMs = FRAME_BUDGET_MS, alpha = 0.5): AutoQualityState {
  if (!(frameMs >= 0) || !Number.isFinite(frameMs)) return s;
  const avg = s.avgMs === null ? frameMs : s.avgMs + alpha * (frameMs - s.avgMs);
  if (avg > budgetMs && s.level < PERF_LADDER.length - 1) return { level: s.level + 1, avgMs: null };
  if (avg < budgetMs * 0.5 && s.level > 0) return { level: s.level - 1, avgMs: null };
  return { level: s.level, avgMs: avg };
}

/** Kullanıcı seçimi → basamak: 'auto' dışındaki seçimler sabit, tam çözünürlük. */
export function fixedLevel(q: Quality): PerfLevel {
  return { quality: q, scale: 1 };
}
