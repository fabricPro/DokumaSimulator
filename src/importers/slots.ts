/**
 * İplik başına renk listesini (eski JSON, WIF) 4 slotluk modele çevirir.
 * Kural (kullanıcı kararı): en sık 4 renk A–D slotu olur; diğerleri en yakın slota eşlenir
 * ve birleştirilen renkler uyarı olarak döner.
 */
import { MAX_SLOTS, SLOT_NAMES, parseColor, type YarnSlot } from '../render-engine';

export interface SlotTemplate {
  count: number;
  system: YarnSlot['system'];
  yarnDensity?: number;
  twist?: 'S' | 'Z';
}

export interface ColorSlotsResult {
  slots: YarnSlot[];
  sequence: number[];
  warnings: string[];
}

function norm(c: string): string {
  const { r, g, b } = parseColor(c);
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

function dist2(a: string, b: string): number {
  const x = parseColor(a);
  const y = parseColor(b);
  return (x.r - y.r) ** 2 + (x.g - y.g) ** 2 + (x.b - y.b) ** 2;
}

/** Dizinin en kısa tekrar periyodu (ör. ABAB AB → AB). */
export function minimalPeriod<T>(seq: T[]): T[] {
  const n = seq.length;
  for (let p = 1; p < n; p++) {
    if (n % p !== 0) continue;
    let ok = true;
    for (let i = p; i < n && ok; i++) if (seq[i] !== seq[i - p]) ok = false;
    if (ok) return seq.slice(0, p);
  }
  return seq.slice();
}

export function colorsToSlots(colors: string[], template: SlotTemplate, label: string): ColorSlotsResult {
  const warnings: string[] = [];
  const list = (colors.length ? colors : ['#808080']).map(norm);
  const freq = new Map<string, { n: number; first: number }>();
  list.forEach((c, i) => {
    const e = freq.get(c);
    if (e) e.n++;
    else freq.set(c, { n: 1, first: i });
  });
  const ranked = [...freq.entries()].sort((a, b) => b[1].n - a[1].n || a[1].first - b[1].first).map(([c]) => c);
  const kept = ranked.slice(0, MAX_SLOTS);
  const merged = ranked.slice(MAX_SLOTS);
  const indexOf = new Map<string, number>();
  kept.forEach((c, i) => indexOf.set(c, i));
  for (const c of merged) {
    let best = 0;
    let bestD = Infinity;
    kept.forEach((k, i) => {
      const d = dist2(c, k);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    indexOf.set(c, best);
  }
  if (merged.length) {
    warnings.push(
      `${label}: ${ranked.length} renk vardı, en sık ${MAX_SLOTS} tanesi slot oldu; ` +
        merged.map((c) => `${c}→${SLOT_NAMES[indexOf.get(c)!]}`).join(', ') +
        ' en yakın slota birleştirildi.',
    );
  }
  const slots: YarnSlot[] = kept.map((color, i) => ({
    name: SLOT_NAMES[i],
    count: template.count,
    system: template.system,
    color,
    ...(template.yarnDensity ? { yarnDensity: template.yarnDensity } : {}),
    twist: template.twist ?? 'S',
  }));
  const sequence = minimalPeriod(list.map((c) => indexOf.get(c)!));
  return { slots, sequence, warnings };
}
