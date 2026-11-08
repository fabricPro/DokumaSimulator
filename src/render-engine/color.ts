/** Renk yardımcıları (saf). */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** #rgb, #rrggbb veya rgb(r,g,b) biçimini çözer; geçersizse gri döner. */
export function parseColor(input: string): RGB {
  const s = String(input).trim().toLowerCase();
  let m = /^#?([0-9a-f]{6})$/.exec(s);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  m = /^#?([0-9a-f]{3})$/.exec(s);
  if (m) {
    const [r, g, b] = m[1].split('').map((c) => parseInt(c + c, 16));
    return { r, g, b };
  }
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(s);
  if (m) return { r: clamp255(+m[1]), g: clamp255(+m[2]), b: clamp255(+m[3]) };
  return { r: 128, g: 128, b: 128 };
}

export function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

export function toHex({ r, g, b }: RGB): string {
  return '#' + [r, g, b].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('');
}

export function toCss({ r, g, b }: RGB, alpha = 1): string {
  return alpha >= 1
    ? `rgb(${clamp255(r)},${clamp255(g)},${clamp255(b)})`
    : `rgba(${clamp255(r)},${clamp255(g)},${clamp255(b)},${Math.max(0, alpha).toFixed(3)})`;
}

/** t>0 beyaza, t<0 siyaha doğru karıştırır (−1..1). */
export function shade(c: RGB, t: number): RGB {
  if (t >= 0) {
    return { r: c.r + (255 - c.r) * t, g: c.g + (255 - c.g) * t, b: c.b + (255 - c.b) * t };
  }
  const k = 1 + t;
  return { r: c.r * k, g: c.g * k, b: c.b * k };
}

/** Renk raporunu iplik indeksine döngüsel uygular. */
export function cycleColor(colors: readonly string[], index: number): string {
  if (colors.length === 0) return '#808080';
  const n = colors.length;
  return colors[((index % n) + n) % n];
}
