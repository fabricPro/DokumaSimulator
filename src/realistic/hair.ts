/**
 * fix-v2 adım 2 (D): tüylülük — iplik yüzeyinden çıkan kısa, kavisli lifler (prototip_render_v2.py).
 * Döşeme başına bir kez CPU'da üretilir (saf, deterministik), renderer saydam bir dokuya çizer; gezinmede
 * yalnız okunur.
 *
 * Prototip: aralık² başına 5 lif (tüylülük 0.35 iken); kök rastgele, boşlukta değil; açı iplik ekseni
 * ± N(0, 0.5) rad (≈ ±29°); uzunluk U(0.25, 0.9)·aralık; 4 parça, her parçada açı + N(0, 0.25);
 * renk kökün rengi ×1.15 + 12 (shader'da, ışıkla); opaklık U(60, 140)/255.
 * VARSAYIM (kalibre edilecek): yoğunluk iplik tüylülüğüyle doğru orantılı, 0.35 → 5 lif / aralık².
 */
import { geometryAt, geometryParamsFromInput } from './geometry';
import { pmod, pitchMm } from './scale';
import type { TileInfo } from './tile';
import type { FabricInput } from './types';

export const HAIR_PER_PITCH2_AT_REF = 5;
export const HAIR_REF_HAIRINESS = 0.35;
export const HAIR_ANGLE_SIGMA = 0.5;
export const HAIR_BEND_SIGMA = 0.25;
export const HAIR_LEN_MIN = 0.25;
export const HAIR_LEN_MAX = 0.9;
export const HAIR_SEGMENTS = 4;

export interface HairStroke {
  /** Polyline noktaları (mm, kumaş uzayı, döşeme içinde kök; uçlar döşeme dışına taşabilir). */
  pts: Array<[number, number]>;
  /** Opaklık 0..1. */
  alpha: number;
  /** Kök ipliğin rengi ('#rrggbb'). */
  color: string;
  /** Kök sistemi: 1 çözgü, 2 atkı. */
  axis: 1 | 2;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rnd: () => number): number {
  const u1 = Math.max(rnd(), 1e-12);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rnd());
}

/**
 * Döşeme için lifler. `hairMul` = Tuning.hairiness (yoğunluk çarpanı). Kök sistemi ve rengi v2 taban
 * geometrisinden (düzensizliksiz ikiz) — döşeme periyodik olduğundan her tekrarda aynı.
 */
export function generateHair(input: FabricInput, tile: TileInfo, hairMul = 1, seed = input.seed ?? 1): HairStroke[] {
  const g = geometryParamsFromInput(input, 1, 0, 'v2');
  const pw = pitchMm(input.density.warpPerCm);
  const hairOf = (axis: 1 | 2, idx: number) => {
    const t = axis === 1 ? input.warp[pmod(idx, input.warp.length)] : input.weft[pmod(idx, input.weft.length)];
    return { h: input.yarnTypes[t.yarnType]?.hairiness ?? 0, color: t.color };
  };
  const hMax = Math.max(0, ...input.yarnTypes.map((y) => y.hairiness));
  if (hMax <= 0 || hairMul <= 0) return [];
  const area = tile.mm[0] * tile.mm[1];
  const candidates = Math.round(((area / (pw * pw)) * HAIR_PER_PITCH2_AT_REF * (hMax / HAIR_REF_HAIRINESS) * hairMul));
  const rnd = mulberry32((seed >>> 0) * 2654435761 + 97);
  const out: HairStroke[] = [];
  for (let n = 0; n < candidates; n++) {
    const x = rnd() * tile.mm[0];
    const y = rnd() * tile.mm[1];
    const s = geometryAt(x, y, g);
    // rastgele sayı akışı kabul / ret'ten bağımsız kalsın diye hepsi önceden çekilir
    const accept = rnd();
    const a0 = gauss(rnd);
    const len = (HAIR_LEN_MIN + (HAIR_LEN_MAX - HAIR_LEN_MIN) * rnd()) * pw;
    const bends = [gauss(rnd), gauss(rnd), gauss(rnd), gauss(rnd)];
    const alpha = (60 + 80 * rnd()) / 255;
    if (s.axis === 0) continue; // boşlukta kök yok
    const root = hairOf(s.axis, s.index);
    if (accept > root.h / hMax) continue; // tüylülüğe göre yoğunluk
    let ang = (s.axis === 1 ? Math.PI / 2 : 0) + HAIR_ANGLE_SIGMA * a0;
    let cx = x;
    let cy = y;
    const pts: Array<[number, number]> = [[cx, cy]];
    for (let k = 0; k < HAIR_SEGMENTS; k++) {
      ang += HAIR_BEND_SIGMA * bends[k];
      cx += (Math.cos(ang) * len) / HAIR_SEGMENTS;
      cy += (Math.sin(ang) * len) / HAIR_SEGMENTS;
      pts.push([cx, cy]);
    }
    out.push({ pts, alpha, color: root.color, axis: s.axis });
  }
  return out;
}
