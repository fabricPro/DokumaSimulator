/**
 * Heightfield dokuma render'ı — reference/weave_render.py `render()` fonksiyonunun birebir karşılığı.
 *
 * Geçişler (her biri ileride ayrı bir WebGL fragment shader geçişine karşılık gelir):
 *   1. fieldsPass     — piksel başına çözgü/atkı yüksekliği, görünür iplik, taban renk
 *   2. lightingPass   — 0.7σ yumuşatma, gradyandan normal, diffuse + specular
 *   3. shadowPass     — ışık yönünde 13 adım ekran uzayı gölge, 1.2σ bulanıklık
 *   4. occlusionPass  — yüksekliğe bağlı AO + 4σ cavity
 *   5. compositePass  — ışık × renk, arka plan, gama
 *
 * Tam görüntü yerine bir bölge (region) istenirse, bulanıklık/gölge komşuluğu için kenar payıyla
 * hesaplanıp kırpılır. Bölge tam görüntüye eşitse çıktı referansla aynı kenar davranışını izler
 * (bulanıklıkta reflect, gölgede np.roll gibi wrap).
 */
import { gaussianBlur } from './gaussian';
import { createRandomSource } from './random';
import { crossProfile, pmod, ply, smoothstep } from './wave';
import type { HeightfieldParams, RandomSource, Region, RgbaImage, WeaveInput } from '../types';

/** Bölge render'ında bulanıklık + gölge komşuluğu için kenar payı (px). */
export const REGION_PAD = 24;

const SHADOW_STEPS = 13;
const LIGHT: [number, number, number] = normalize3([-0.2, 0.62, 0.7]);
const HALF: [number, number, number] = normalize3([LIGHT[0], LIGHT[1], LIGHT[2] + 1]);
const BG_RGB: [number, number, number] = [0.035, 0.04, 0.05];

function normalize3(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.trim().replace(/^#/, '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full.slice(0, 6), 16);
  if (!Number.isFinite(n)) return [0.5, 0.5, 0.5];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Tam kumaş görüntüsünün piksel boyutu. */
export function imageSize(input: Pick<WeaveInput, 'nWarp' | 'nWeft'>, cell: number): { width: number; height: number } {
  return { width: Math.max(1, Math.round(input.nWarp * cell)), height: Math.max(1, Math.round(input.nWeft * cell)) };
}

/** Hesap tamponu: istenen bölge + kenar payı, tam görüntü sınırlarına kırpılmış. */
export interface Buffer {
  /** Tamponun tam görüntüdeki sol üst köşesi. */
  x0: number;
  y0: number;
  w: number;
  h: number;
  /** Tam görüntü boyutu. */
  W: number;
  H: number;
  /** Tampon tam görüntünün tamamı mı (referans kenar davranışı). */
  full: boolean;
}

export interface Fields {
  height: Float32Array;
  baseR: Float32Array;
  baseG: Float32Array;
  baseB: Float32Array;
  isBg: Uint8Array;
  /** Arka plan yüksekliği ve AO normalizasyon sabitleri. */
  bg: number;
  hTop: number;
  r: number;
}

/* ------------------------------------------------------------------ */
/* 1. Alanlar                                                          */
/* ------------------------------------------------------------------ */

export function fieldsPass(input: WeaveInput, p: HeightfieldParams, buf: Buffer, rnd: RandomSource): Fields {
  const M = input.weave;
  const Rr = M.length;
  const Rc = M[0].length;
  const { cell, wobble } = p;
  const nWarp = input.nWarp;
  const nWeft = input.nWeft;
  const r = (p.yarnRatio * cell) / 2.0;
  const amp = r * 0.85;
  const pitch = p.plyPitch * cell;
  const bump = r * 0.42;
  const bg = -amp - r * 1.2;

  const wc = input.warpColors.map(hexToRgb01);
  const fc = input.weftColors.map(hexToRgb01);
  const warpPhase = new Float64Array(nWarp);
  const warpTone = new Float64Array(nWarp);
  for (let i = 0; i < nWarp; i++) {
    warpPhase[i] = rnd.warpPhase(i);
    warpTone[i] = rnd.warpTone(i);
  }
  const weftPhase = new Float64Array(nWeft);
  const weftTone = new Float64Array(nWeft);
  for (let j = 0; j < nWeft; j++) {
    weftPhase[j] = rnd.weftPhase(j);
    weftTone[j] = rnd.weftTone(j);
  }
  // Örgü matrisini düz diziye al (M[row][col] → mat[row*Rc+col])
  const mat = new Uint8Array(Rr * Rc);
  for (let a = 0; a < Rr; a++) for (let b = 0; b < Rc; b++) mat[a * Rc + b] = M[a][b] ? 1 : 0;

  const n = buf.w * buf.h;
  const height = new Float32Array(n);
  const baseR = new Float32Array(n);
  const baseG = new Float32Array(n);
  const baseB = new Float32Array(n);
  const isBg = new Uint8Array(n);

  for (let by = 0; by < buf.h; by++) {
    const yy = buf.y0 + by;
    const yb = buf.H - 1 - yy; // alttan yukarı
    // Atkı: satır sabitleri
    const j = Math.min(Math.max(Math.floor(yb / cell), 0), nWeft - 1);
    const jRow = pmod(j, Rr) * Rc;
    // Çözgü dalgası için satır sabitleri
    const t = yb / cell - 0.5;
    const k0 = Math.floor(t);
    const f = smoothstep(t - k0);
    const row0 = pmod(k0, Rr) * Rc;
    const row1 = pmod(k0 + 1, Rr) * Rc;

    for (let bx = 0; bx < buf.w; bx++) {
      const xx = buf.x0 + bx;
      const o = by * buf.w + bx;

      // --- çözgü ---
      const i = Math.min(Math.max(Math.floor(xx / cell), 0), nWarp - 1);
      const ic = pmod(i, Rc);
      const cx = (i + 0.5) * cell + wobble * Math.sin(yb / (cell * 3.1) + warpPhase[i]);
      const dx = xx - cx;
      const s0 = mat[row0 + ic] ? 1 : -1;
      const s1 = mat[row1 + ic] ? 1 : -1;
      const hwWave = (s0 * (1 - f) + s1 * f) * amp;
      const profW = crossProfile(dx, r);
      const covW = Math.abs(dx) < r;

      // --- atkı ---
      const cy = (j + 0.5) * cell + wobble * Math.sin(xx / (cell * 2.7) + weftPhase[j]);
      const dy = yb - cy;
      const t2 = xx / cell - 0.5;
      const k2 = Math.floor(t2);
      const f2 = smoothstep(t2 - k2);
      const q0 = mat[jRow + pmod(k2, Rc)] ? -1 : 1;
      const q1 = mat[jRow + pmod(k2 + 1, Rc)] ? -1 : 1;
      const hfWave = (q0 * (1 - f2) + q1 * f2) * amp;
      const profF = crossProfile(dy, r);
      const covF = Math.abs(dy) < r;

      // --- büküm ---
      const plyW = ply(yb, dx / r, r, p.twistAngle, pitch);
      const plyF = ply(xx, -dy / r, r, p.twistAngle, pitch);

      // --- lif gürültüsü ---
      const fnW = rnd.warpFiber(xx, yy);
      const fnF = rnd.weftFiber(xx, yy);

      const Hw = covW ? hwWave + profW + bump * plyW + 0.25 * fnW : -1e3;
      const Hf = covF ? hfWave + profF + bump * plyF + 0.25 * fnF : -1e3;
      const topW = Hw >= Hf;
      const Hm = Math.max(Hw, Hf, bg);
      height[o] = Hm;
      isBg[o] = Hm <= bg + 1e-3 ? 1 : 0;

      // --- renk ---
      let cr: number, cg: number, cb: number, pv: number, fv: number;
      if (topW) {
        const c = wc[i % wc.length];
        const v = warpTone[i];
        cr = c[0] * v;
        cg = c[1] * v;
        cb = c[2] * v;
        pv = plyW;
        fv = fnW;
      } else {
        const c = fc[j % fc.length];
        const v = weftTone[j];
        cr = c[0] * v;
        cg = c[1] * v;
        cb = c[2] * v;
        pv = plyF;
        fv = fnF;
      }
      const m = (0.8 + 0.2 * pv) * (1 + 0.09 * fv);
      baseR[o] = cr * m;
      baseG[o] = cg * m;
      baseB[o] = cb * m;
    }
  }
  return { height, baseR, baseG, baseB, isBg, bg, hTop: amp + r * 0.6 + bump, r };
}

/* ------------------------------------------------------------------ */
/* 2. Normal + ışık                                                    */
/* ------------------------------------------------------------------ */

/** np.gradient: içeride merkezi fark, kenarlarda tek yönlü fark. */
function gradientAt(a: Float32Array, w: number, h: number, x: number, y: number): [number, number] {
  const o = y * w + x;
  let gx: number;
  if (w < 2) gx = 0;
  else if (x === 0) gx = a[o + 1] - a[o];
  else if (x === w - 1) gx = a[o] - a[o - 1];
  else gx = (a[o + 1] - a[o - 1]) / 2;
  let gy: number;
  if (h < 2) gy = 0;
  else if (y === 0) gy = a[o + w] - a[o];
  else if (y === h - 1) gy = a[o] - a[o - w];
  else gy = (a[o + w] - a[o - w]) / 2;
  return [gx, gy];
}

export function lightingPass(height: Float32Array, buf: Buffer): { diff: Float32Array; spec: Float32Array } {
  const { w, h } = buf;
  const Hs = gaussianBlur(height, w, h, 0.7);
  const diff = new Float32Array(w * h);
  const spec = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [gx, gyRaw] = gradientAt(Hs, w, h, x, y);
      const gy = -gyRaw; // görüntü y'si aşağı
      let nx = -gx;
      let ny = -gy;
      let nz = 1;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= nl;
      ny /= nl;
      nz /= nl;
      const o = y * w + x;
      diff[o] = Math.min(Math.max(nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2], 0), 1);
      spec[o] = Math.min(Math.max(nx * HALF[0] + ny * HALF[1] + nz * HALF[2], 0), 1) ** 18;
    }
  }
  return { diff, spec };
}

/* ------------------------------------------------------------------ */
/* 3. Ekran uzayı gölge                                                */
/* ------------------------------------------------------------------ */

export function shadowPass(height: Float32Array, buf: Buffer): Float32Array {
  const { w, h } = buf;
  const shadow = new Float32Array(w * h).fill(1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = y * w + x;
      const hc = height[o];
      let s = 1;
      for (let k = 1; k <= SHADOW_STEPS; k++) {
        // np.roll(·, k) → kaynak (y−k, x−k): ışık sol üstten, sol üste bak
        let sy = y - k;
        let sx = x - k;
        if (buf.full) {
          sy = pmod(sy, h);
          sx = pmod(sx, w);
        } else {
          if (sy < 0) sy = 0;
          if (sx < 0) sx = 0;
        }
        if (height[sy * w + sx] > hc + k * 1.1) {
          const v = 0.35 + 0.04 * k;
          if (v < s) s = v;
        }
      }
      shadow[o] = s;
    }
  }
  return gaussianBlur(shadow, w, h, 1.2);
}

/* ------------------------------------------------------------------ */
/* 4. Ortam kapatması                                                  */
/* ------------------------------------------------------------------ */

export function occlusionPass(height: Float32Array, fields: Fields, buf: Buffer): Float32Array {
  const { w, h } = buf;
  const { bg, hTop, r } = fields;
  const blurred = gaussianBlur(height, w, h, 4);
  const occ = new Float32Array(w * h);
  for (let o = 0; o < occ.length; o++) {
    const hn = (height[o] - bg) / (hTop - bg);
    const ao = Math.min(Math.max(0.3 + 0.85 * hn, 0.18), 1.0);
    const cavity = Math.min(Math.max(1 - Math.max(blurred[o] - height[o], 0) / (r * 0.9), 0.35), 1);
    occ[o] = ao * cavity;
  }
  return occ;
}

/* ------------------------------------------------------------------ */
/* 5. Birleştirme                                                      */
/* ------------------------------------------------------------------ */

export function compositePass(
  fields: Fields,
  diff: Float32Array,
  spec: Float32Array,
  shadow: Float32Array,
  occ: Float32Array,
  buf: Buffer,
  region: Region,
): RgbaImage {
  const out = new Uint8ClampedArray(region.width * region.height * 4);
  const gamma = 1 / 1.1;
  const ox = region.x - buf.x0;
  const oy = region.y - buf.y0;
  for (let y = 0; y < region.height; y++) {
    for (let x = 0; x < region.width; x++) {
      const o = (y + oy) * buf.w + (x + ox);
      let r: number, g: number, b: number;
      if (fields.isBg[o]) {
        [r, g, b] = BG_RGB;
      } else {
        const light = (0.22 + 0.95 * diff[o]) * shadow[o] * occ[o];
        const sp = 0.12 * spec[o] * shadow[o];
        r = fields.baseR[o] * light + sp;
        g = fields.baseG[o] * light + sp;
        b = fields.baseB[o] * light + sp;
      }
      const j = (y * region.width + x) * 4;
      // np.clip → ** (1/1.1) → (·255).astype(uint8) (aşağı yuvarlama)
      out[j] = Math.floor(Math.min(Math.max(r, 0), 1) ** gamma * 255);
      out[j + 1] = Math.floor(Math.min(Math.max(g, 0), 1) ** gamma * 255);
      out[j + 2] = Math.floor(Math.min(Math.max(b, 0), 1) ** gamma * 255);
      out[j + 3] = 255;
    }
  }
  return { width: region.width, height: region.height, data: out };
}

/* ------------------------------------------------------------------ */

export function makeBuffer(W: number, H: number, region: Region, pad = REGION_PAD): Buffer {
  const x0 = Math.max(0, region.x - pad);
  const y0 = Math.max(0, region.y - pad);
  const x1 = Math.min(W, region.x + region.width + pad);
  const y1 = Math.min(H, region.y + region.height + pad);
  const full = x0 === 0 && y0 === 0 && x1 === W && y1 === H;
  return { x0, y0, w: x1 - x0, h: y1 - y0, W, H, full };
}

/** Bölgeyi tam görüntü sınırlarına kırpar. */
export function clampRegion(region: Region, W: number, H: number): Region {
  const x = Math.max(0, Math.min(W, Math.floor(region.x)));
  const y = Math.max(0, Math.min(H, Math.floor(region.y)));
  const x1 = Math.max(x, Math.min(W, Math.ceil(region.x + region.width)));
  const y1 = Math.max(y, Math.min(H, Math.ceil(region.y + region.height)));
  return { x, y, width: x1 - x, height: y1 - y };
}

export interface RenderHeightfieldOptions {
  /** Tam görüntünün yalnızca bu bölgesini hesapla (varsayılan: tamamı). */
  region?: Region;
  /** Rastgelelik kaynağı (varsayılan: params.seed ile önbellekli). */
  random?: RandomSource;
}

/**
 * Örgüyü heightfield yöntemiyle RGBA piksel tamponuna çizer.
 * Saf hesap: DOM/Canvas gerektirmez; Worker'da veya Node'da çalışır.
 */
export function renderHeightfield(
  input: WeaveInput,
  params: HeightfieldParams,
  opts: RenderHeightfieldOptions = {},
): RgbaImage {
  validateInput(input);
  const { width: W, height: H } = imageSize(input, params.cell);
  const region = clampRegion(opts.region ?? { x: 0, y: 0, width: W, height: H }, W, H);
  if (region.width === 0 || region.height === 0) {
    return { width: region.width, height: region.height, data: new Uint8ClampedArray(0) };
  }
  const buf = makeBuffer(W, H, region);
  const rnd = opts.random ?? createRandomSource(params.seed);
  const fields = fieldsPass(input, params, buf, rnd);
  const { diff, spec } = lightingPass(fields.height, buf);
  const shadow = shadowPass(fields.height, buf);
  const occ = occlusionPass(fields.height, fields, buf);
  return compositePass(fields, diff, spec, shadow, occ, buf, region);
}

export function validateInput(input: WeaveInput): void {
  const M = input.weave;
  if (!Array.isArray(M) || M.length === 0 || !Array.isArray(M[0]) || M[0].length === 0) {
    throw new Error('Örgü matrisi boş.');
  }
  const w = M[0].length;
  M.forEach((row, i) => {
    if (row.length !== w) throw new Error(`Örgü satırı ${i} genişliği ${w} olmalı.`);
  });
  if (!(input.nWarp >= 1 && input.nWeft >= 1)) throw new Error('İplik sayıları ≥ 1 olmalı.');
  if (input.warpColors.length === 0 || input.weftColors.length === 0) throw new Error('Renk raporu boş.');
}
