/**
 * Hazır örgüler — reference/weave_render.py'deki tanımlarla birebir aynı.
 * Matris satırı = atkı (0. satır ilk dokunan, en altta), sütun = çözgü; true = çözgü üstte.
 */

export interface WeavePreset {
  id: string;
  name: string;
  weave: boolean[][];
}

function build(w: number, h: number, f: (x: number, y: number) => boolean): boolean[][] {
  const rows: boolean[][] = [];
  for (let y = 0; y < h; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < w; x++) row.push(f(x, y));
    rows.push(row);
  }
  return rows;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

export const plain = () => build(2, 2, (x, y) => (x + y) % 2 === 0);
export const twill31 = () => build(4, 4, (x, y) => mod(x - y, 4) !== 3);
export const twill22 = () => build(4, 4, (x, y) => mod(x - y, 4) < 2);
export const satin5 = () => build(5, 5, (x, y) => (x + y * 2) % 5 !== 0);
export const hopsack = () => build(4, 4, (x, y) => (Math.floor(x / 2) + Math.floor(y / 2)) % 2 === 0);

/** Referanstaki 12×12 armür motifi; metin üstten aşağı yazılıdır, matris alttan yukarıdır. */
export function dobbyFancy(): boolean[][] {
  const s = `
    101100101101
    010011010010
    101101100101
    110010011010
    001101101101
    110100110010
    101011001101
    010110110010
    101001011011
    011110100100
    100101011011
    011010100100`;
  const rows = s
    .trim()
    .split('\n')
    .map((r) => r.trim());
  return rows.reverse().map((r) => r.split('').map((c) => c === '1'));
}

export const WEAVE_PRESETS: WeavePreset[] = [
  { id: 'plain', name: 'Bezayağı', weave: plain() },
  { id: 'twill22', name: '2/2 Dimi', weave: twill22() },
  { id: 'twill31', name: '3/1 Dimi', weave: twill31() },
  { id: 'satin5', name: "5'li Saten", weave: satin5() },
  { id: 'panama', name: 'Panama', weave: hopsack() },
  { id: 'dobby', name: 'Armür motifi', weave: dobbyFancy() },
];

export function getPreset(id: string): WeavePreset | undefined {
  return WEAVE_PRESETS.find((p) => p.id === id);
}
