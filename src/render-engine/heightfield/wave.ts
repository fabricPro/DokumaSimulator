/**
 * İplik dalgası ve kesit fonksiyonları (saf, piksel başına; shader'a doğrudan taşınabilir).
 * Karşılık: reference/weave_render.py satır 40–79.
 */

export function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Python `%` gibi her zaman pozitif mod. */
export function pmod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/**
 * Bağlantı işareti. `row` alttan yukarı atkı indeksi, `col` çözgü indeksi (rapor dışına taşabilir).
 * Çözgü için: matris true → +1 (üstte), false → −1. Atkı için işaret terstir.
 */
export function warpSign(M: boolean[][], row: number, col: number): number {
  return M[pmod(row, M.length)][pmod(col, M[0].length)] ? 1 : -1;
}

export function weftSign(M: boolean[][], row: number, col: number): number {
  return M[pmod(row, M.length)][pmod(col, M[0].length)] ? -1 : 1;
}

/**
 * İplik boyunca dalga: hücre merkezlerinde ±1, arada smoothstep geçişi.
 * `pos` iplik boyu koordinatı (px), `stateAt(k)` k. hücrenin işareti (±1).
 */
export function alongWave(pos: number, cell: number, stateAt: (k: number) => number): number {
  const t = pos / cell - 0.5;
  const k0 = Math.floor(t);
  const f = smoothstep(t - k0);
  return stateAt(k0) * (1 - f) + stateAt(k0 + 1) * f;
}

/** Yarım daire kesit profili (yarıçapın 0.6'sı ölçekli). d = merkeze uzaklık (px). */
export function crossProfile(d: number, r: number): number {
  const u = Math.min(Math.abs(d) / r, 1);
  return r * 0.6 * Math.sqrt(Math.max(1 - u * u, 0));
}

/**
 * 2 katlı büküm kabartması. u: iplik boyu (px), v: kesit içi −1..1.
 * 0 = katlar arası oluk, 1 = kat sırtı.
 */
export function ply(u: number, v: number, r: number, twistAngle: number, pitch: number): number {
  const phase = (u + v * r * twistAngle * 2.0) / pitch;
  return Math.sqrt(Math.abs(Math.sin(Math.PI * phase)));
}
