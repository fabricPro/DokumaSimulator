/**
 * Geometri modeli (saf; G-buffer shader'ının CPU ikizi — adımlar birebir).
 *
 * Kaynak: render-engine/physical/simulate.ts "fields" geçişi (reference/weave_phys.py karşılığı):
 *  - iplik merkezleri: (i + 0.5)·p + kayma(i) (Faz 4 düzensizliği; kapalıyken eşit aralık);
 *  - krepaj: iplik boyunca, çapraz iplik merkezleri arasında smoothstep geçişi;
 *    genlik D·β (çözgü) ve D·(1 − β) (atkı), D = r_çözgü + r_en yakın atkı, β = krepaj payı (0.4).
 *    Uzun flottede komşu durumlar aynı olduğu için dalga düzleşir; sık bağlantıda dalgalanır.
 *  - üstte olan: yüksekliği büyük olan iplik (eşitlikte çözgü), ikisi de yoksa zemin.
 *  - Kayma/kalınlık komşu hücreye taşabildiği için her eksende i−1, i, i+1 adayları denenir.
 *
 * Kesit elips: yarı genişlik a = r·√k, yarı yükseklik b = r/√k (kesit alanı πr² korunur).
 * Yükseklik profili 0.6·b·√(1 − (d/a)²): 0.6 çarpanı referanstan (görsel basıklık); k = 1 ve
 * düzensizlik kapalıyken referansla birebir aynıdır.
 *
 * İki parametre seti (`model`):
 *  - 'classic': yukarıdaki model (CPU heightfield ile tutarlılık kontrolü ve eski testler bununla);
 *  - 'v2' (fix-v2, reference/realistic-v2/prototip_render_v2.py): tam elips profil (ölçek 1, basıklık yok),
 *    cosine krepaj geçişi, genlik çözgüde 0.45·r_çözgü, atkıda 0.40·r_en yakın çözgü. Prototipte bombe /
 *    krepaj oranı ≈ 1 / 0.45; classic'te 0.6·b / (0.8·r) ≈ 0.75 idi ("tahta, tuğla" görüntüsünün nedeni).
 */
import type { FabricInput } from './types';
import { DEFAULT_YARN_DENSITY, diameterMm, toTex } from './yarn';
import { pitchMm, pmod } from './scale';
import { positionOffset, resolveIrregularity, thicknessScale } from './irregularity';

/** VARSAYIM (kalibre edilecek): basıklık k = 1 + 1.2·max(0, d/p − 0.6), [1, 2.2] aralığında.
 *  d/p: iplik çapı / iplik aralığı (doluluk). Doluluk 0.6'yı aşınca iplik yanlara yayılır.
 *  factor: 0 → hep daire (tutarlılık testi), 1 → varsayılan model. */
export const FLATTEN_SLOPE = 1.2;
export const FLATTEN_START = 0.6;
export const FLATTEN_MAX = 2.2;
export const PROFILE_SCALE = 0.6;
export const DEFAULT_CRIMP_SHARE = 0.4;

/** v2 (prototip) sabitleri. VARSAYIM (kalibre edilecek): prototip birimleri çözgü yarıçapı = 1. */
export const V2_PROFILE_SCALE = 1.0;
export const V2_CRIMP_WARP = 0.45;
export const V2_CRIMP_WEFT = 0.4;
export type GeometryModel = 'classic' | 'v2';

/** Cosine geçiş (1 − cos πs)/2 — prototipteki `sm`. */
export const cosStep01 = (t: number) => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return (1 - Math.cos(Math.PI * x)) / 2;
};

export function flattening(diameterMm: number, pitchMm: number, factor = 1): number {
  const k = 1 + factor * FLATTEN_SLOPE * Math.max(0, diameterMm / pitchMm - FLATTEN_START);
  return Math.min(FLATTEN_MAX, Math.max(1, k));
}

export function ellipseAxes(r: number, k: number): { a: number; b: number } {
  return { a: r * Math.sqrt(k), b: r / Math.sqrt(k) };
}

export const smoothstep01 = (t: number) => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
};

export interface GeometryParams {
  /** Hücre durumu: çözgü (global i) atkı (global j) üzerinde mi. */
  warpUp: (i: number, j: number) => boolean;
  /** Global çözgü / atkı yarıçapı (mm), düzensizlik dahil. */
  warpRadius: (i: number) => number;
  weftRadius: (j: number) => number;
  /** Global çözgü / atkı merkezi (mm), düzensizlik dahil. */
  warpCenter: (i: number) => number;
  weftCenter: (j: number) => number;
  pitchWarp: number;
  pitchWeft: number;
  crimpShare: number;
  /** Parametre seti; verilmezse 'classic'. */
  model?: GeometryModel;
  flattenFactor: number;
  /** Zemin yüksekliği = −(en büyük çözgü r + en büyük atkı r)·1.4. */
  bgHeight: number;
}

export interface GeometrySample {
  height: number;
  /** 0 zemin, 1 çözgü, 2 atkı (G-buffer gb1.z ile aynı). */
  axis: 0 | 1 | 2;
  /** İplik indeksi i / j (orijinin solunda / altında negatif). */
  index: number;
  /**
   * Eski kimlik: +(i+1) çözgü, −(j+1) atkı, 0 zemin — CPU heightfield'ın topId'si ile karşılaştırma için.
   * Negatif indekslerde belirsizdir (çözgü −1 → 0); karar için `axis` + `index` kullanın.
   */
  id: number;
  /** Kesit içi konum −1..1 (zeminde 0). */
  v: number;
  /** Kesit yarı genişliği a (mm). */
  a: number;
  /** Yükseklik eğimi (dh/dx, dh/dy), mm/mm. */
  grad: [number, number];
}

/** x'e en yakın merkez (aday i−1, i, i+1). */
function nearest(x: number, pitch: number, center: (k: number) => number): number {
  const i = Math.floor(x / pitch);
  let best = i;
  let bd = Math.abs(x - center(i));
  for (const k of [i - 1, i + 1]) {
    const dd = Math.abs(x - center(k));
    if (dd < bd) {
      bd = dd;
      best = k;
    }
  }
  return best;
}

/** c(k0) ≤ x < c(k0+1) aralığı ve smoothstep kesri. */
function interval(x: number, pitch: number, center: (k: number) => number): { k0: number; s: number } {
  let k0 = Math.floor(x / pitch - 0.5);
  if (x < center(k0)) k0 -= 1;
  else if (x >= center(k0 + 1)) k0 += 1;
  const c0 = center(k0);
  const c1 = center(k0 + 1);
  return { k0, s: Math.min(1, Math.max(0, (x - c0) / (c1 - c0))) };
}

/** Kesit eğimi: d/dd [0.6·b·√(1−(d/a)²)] = −0.6·b·u / (a·√(1−u²)); kenarda sınırlanır. */
function slope(u: number, a: number, b: number, scale = PROFILE_SCALE): number {
  return (-scale * b * u) / (a * Math.sqrt(Math.max(1 - u * u, 0.0025)));
}

/** Bir kumaş noktasının (mm) G-buffer değerleri. Shader ile aynı adımlar. */
export function geometryAt(X: number, Y: number, g: GeometryParams): GeometrySample {
  const pw = g.pitchWarp;
  const pf = g.pitchWeft;
  const beta = g.crimpShare;
  const v2 = g.model === 'v2';
  const prof = v2 ? V2_PROFILE_SCALE : PROFILE_SCALE;
  const step = v2 ? cosStep01 : smoothstep01;
  // d(step)/ds: smoothstep 6s(1−s), cosine (π/2)·sin(πs)
  const dStep = (t: number) => (v2 ? (Math.PI / 2) * Math.sin(Math.PI * t) : 6 * t * (1 - t));
  const jN = nearest(Y, pf, g.weftCenter);
  const iN = nearest(X, pw, g.warpCenter);
  const rfN = g.weftRadius(jN);
  const rwN = g.warpRadius(iN);

  let best = { h: -1e3, axis: 0 as 0 | 1 | 2, index: 0, v: 0, a: 0, grad: [0, 0] as [number, number] };

  // Çözgü adayları: kesit x yönünde, krepaj y yönünde
  const iv = interval(Y, pf, g.weftCenter);
  const fW = step(iv.s);
  const dsW = dStep(iv.s) / (g.weftCenter(iv.k0 + 1) - g.weftCenter(iv.k0));
  const i0 = Math.floor(X / pw);
  for (const i of [i0 - 1, i0, i0 + 1]) {
    const rw = g.warpRadius(i);
    const k = v2 ? 1 : flattening(2 * rw, pw, g.flattenFactor);
    const { a, b } = ellipseAxes(rw, k);
    const dx = X - g.warpCenter(i);
    if (!(Math.abs(dx) < a)) continue;
    const amp = v2 ? V2_CRIMP_WARP * rw : (rw + rfN) * beta;
    const s0 = g.warpUp(i, iv.k0) ? 1 : -1;
    const s1 = g.warpUp(i, iv.k0 + 1) ? 1 : -1;
    const u = dx / a;
    const h = (s0 * (1 - fW) + s1 * fW) * amp + prof * b * Math.sqrt(Math.max(0, 1 - u * u));
    if (h > best.h) {
      best = { h, axis: 1, index: i, v: u, a, grad: [slope(u, a, b, prof), (s1 - s0) * amp * dsW] };
    }
  }

  // Atkı adayları: kesit y yönünde, krepaj x yönünde; işaret ters
  const ih = interval(X, pw, g.warpCenter);
  const fF = step(ih.s);
  const dsF = dStep(ih.s) / (g.warpCenter(ih.k0 + 1) - g.warpCenter(ih.k0));
  const j0 = Math.floor(Y / pf);
  const bestWarpH = best.axis === 1 ? best.h : -1e3;
  for (const j of [j0 - 1, j0, j0 + 1]) {
    const rf = g.weftRadius(j);
    const k = v2 ? 1 : flattening(2 * rf, pf, g.flattenFactor);
    const { a, b } = ellipseAxes(rf, k);
    const dy = Y - g.weftCenter(j);
    if (!(Math.abs(dy) < a)) continue;
    const amp = v2 ? V2_CRIMP_WEFT * rwN : (rwN + rf) * (1 - beta);
    const q0 = g.warpUp(ih.k0, j) ? -1 : 1;
    const q1 = g.warpUp(ih.k0 + 1, j) ? -1 : 1;
    const u = dy / a;
    const h = (q0 * (1 - fF) + q1 * fF) * amp + prof * b * Math.sqrt(Math.max(0, 1 - u * u));
    // Eşitlikte çözgü üstte kalır (referans: Hw >= Hf)
    if (h > best.h && h > bestWarpH) {
      best = { h, axis: 2, index: j, v: u, a, grad: [(q1 - q0) * amp * dsF, slope(u, a, b, prof)] };
    }
  }

  if (best.h <= g.bgHeight + 1e-6) return { height: g.bgHeight, axis: 0, index: 0, id: 0, v: 0, a: 0, grad: [0, 0] };
  const id = best.axis === 1 ? best.index + 1 : -(best.index + 1);
  return { height: best.h, axis: best.axis, index: best.index, id, v: best.v, a: best.a, grad: best.grad };
}

/**
 * FabricInput → geometri parametreleri (shader uniform'larıyla aynı değerler).
 * irregularityMul: Tuning.irregularity (0 = düzensizlik kapalı).
 */
export function geometryParamsFromInput(
  input: FabricInput,
  flattenFactor = 1,
  irregularityMul = 1,
  model: GeometryModel = 'classic',
): GeometryParams {
  const radiusOfType = input.yarnTypes.map((y) => diameterMm(toTex(y.count, y.unit), y.yarnDensity ?? DEFAULT_YARN_DENSITY) / 2);
  const warpR = input.warp.map((t) => radiusOfType[t.yarnType]);
  const weftR = input.weft.map((t) => radiusOfType[t.yarnType]);
  const { warps, wefts, data } = input.weave;
  const ir = resolveIrregularity(input, irregularityMul);
  const pw = pitchMm(input.density.warpPerCm);
  const pf = pitchMm(input.density.weftPerCm);
  return {
    warpUp: (i, j) => data[pmod(j, wefts) * warps + pmod(i, warps)] === 1,
    warpRadius: (i) => warpR[pmod(i, warpR.length)] * thicknessScale(0, i, ir),
    weftRadius: (j) => weftR[pmod(j, weftR.length)] * thicknessScale(1, j, ir),
    warpCenter: (i) => (i + 0.5) * pw + positionOffset(0, i, pw, ir),
    weftCenter: (j) => (j + 0.5) * pf + positionOffset(1, j, pf, ir),
    pitchWarp: pw,
    pitchWeft: pf,
    crimpShare: input.crimpShare ?? DEFAULT_CRIMP_SHARE,
    flattenFactor,
    model,
    bgHeight: -(Math.max(...warpR) + Math.max(...weftR)) * (1 + ir.thickness) * 1.4,
  };
}
