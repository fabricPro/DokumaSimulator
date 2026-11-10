/**
 * Fiziksel ölçekli heightfield render — reference/weave_phys.py `simulate()` karşılığı.
 * Konumlar tarak + çekme yay modelinden (shrinkDistribution.ts), sıkışma kesiti Love (1954)
 * racetrack'i ile; %0 çekme ve sıkışmasız durumda referansla piksel olarak aynıdır.
 *
 * Koordinatlar mm; ölçek px/mm. Her iplik kendi çapında, kendi konumunda, kendi kesitiyle ve
 * büküm aralığıyla (1.5·r) çizilir. Geçişler (ileride WebGL'e ayrı ayrı taşınabilir):
 *   fields → lighting → shadow → occlusion → composite (+ ölçek çubuğu).
 */
import { gaussianBlur } from '../heightfield/gaussian';
import { pmod } from '../heightfield/wave';
import type { FabricSpec, RgbaImage } from '../types';
import type { PositionGenerator } from './positions';
import { finishedDensities } from './shrinkage';
import { buildFabricPositions, type FabricPositions } from './shrinkDistribution';
import { MIN_SQUEEZE } from './squeeze';
import { createPhysicalRandom, type PhysicalRandomSource } from './random';
import { slotIndices, slotTable } from './yarns';

export interface PhysicalView {
  /** Pencerenin sol alt köşesi (mm, kumaş koordinatı; y yukarı). */
  x0Mm: number;
  y0Mm: number;
  widthMm: number;
  heightMm: number;
  pxPerMm: number;
}

export interface SimulateOptions {
  random?: PhysicalRandomSource;
  seed?: number;
  /** 1 mm ölçek çubuğu (sol alt). Varsayılan true. */
  scaleBar?: boolean;
  /**
   * Hata ayıklama (gerçekçi mod tutarlılık testi). Verilmezse çıktı aynen eskisi gibidir.
   *  geometryOnly: wobble, büküm kabartması ve lif gürültüsü kapalı (yalnız krepaj + kesit).
   *  collect: ham yükseklik (mm) ve üstteki iplik kimliği döndürülür.
   */
  debug?: { geometryOnly?: boolean; collect?: boolean };
  /** Hazır hesaplanmış konumlar (verilmezse spec'ten tarak + yay modeliyle üretilir). */
  positions?: FabricPositions;
  /** Konum üreticilerini doğrudan ezmek için (test/deney). */
  warpPositions?: PositionGenerator;
  weftPositions?: PositionGenerator;
}

export interface SimulateDebug {
  /** Ham yükseklik (mm), satır 0 = görüntünün üstü. */
  height: Float32Array;
  /** Üstteki iplik: +(gW+1) çözgü, −(gF+1) atkı, 0 zemin (global indeks). */
  topId: Int32Array;
}

export interface SimulateResult {
  image: RgbaImage;
  /** Açıklık %: arka plan piksel oranı. */
  openPct: number;
  /** Mamul sıklıklar. */
  Dw: number;
  Df: number;
  /** "Sıkıştı": penceredeki bir komşu aralığı 0.55·(r+r)'nin altında. */
  jammedWarp: boolean;
  jammedWeft: boolean;
  /** Penceredeki ipliklerin slot indeksleri (referansla aynı metrik ortalaması için). */
  warpSlotsUsed: Int32Array;
  debug?: SimulateDebug;
  weftSlotsUsed: Int32Array;
}

const LIGHT = norm3([-0.2, 0.62, 0.7]);
const HALF = norm3([LIGHT[0], LIGHT[1], LIGHT[2] + 1]);
const BG_RGB: [number, number, number] = [0.035, 0.04, 0.05];
const WOBBLE = 0.012;

function norm3(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

function smoothstepClip(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

/** np.searchsorted(c, x, side='left'): c[idx] >= x olan ilk indeks. */
function searchsorted(c: Float64Array, x: number): number {
  let lo = 0;
  let hi = c.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (c[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Referans nearest_index. */
function nearestIndex(c: Float64Array, x: number): number {
  let k = searchsorted(c, x);
  if (k < 1) k = 1;
  if (k > c.length - 1) k = c.length - 1;
  return x - c[k - 1] < c[k] - x ? k - 1 : k;
}

/** Referans interval: k0 ve smoothstep'li kesir. */
function interval(c: Float64Array, x: number): [number, number] {
  let k0 = searchsorted(c, x) - 1;
  if (k0 < 0) k0 = 0;
  if (k0 > c.length - 2) k0 = c.length - 2;
  return [k0, smoothstepClip((x - c[k0]) / (c[k0 + 1] - c[k0]))];
}

function median(a: ArrayLike<number>): number {
  const s = Array.from(a).sort((x, y) => x - y);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

function gradientAt(a: Float32Array, w: number, h: number, x: number, y: number): [number, number] {
  const o = y * w + x;
  const gx = w < 2 ? 0 : x === 0 ? a[o + 1] - a[o] : x === w - 1 ? a[o] - a[o - 1] : (a[o + 1] - a[o - 1]) / 2;
  const gy = h < 2 ? 0 : y === 0 ? a[o + w] - a[o] : y === h - 1 ? a[o] - a[o - w] : (a[o + w] - a[o - w]) / 2;
  return [gx, gy];
}

export function simulatePhysical(spec: FabricSpec, view: PhysicalView, opts: SimulateOptions = {}): SimulateResult {
  const M = spec.weave;
  const Rr = M.length;
  const Rc = M[0].length;
  const ppm = view.pxPerMm;
  const rnd = opts.random ?? createPhysicalRandom(opts.seed ?? 3);

  const fabric = opts.warpPositions && opts.weftPositions ? null : (opts.positions ?? buildFabricPositions(spec));
  const { warp: Dw, weft: Df } = finishedDensities(
    fabric?.reedDensity ?? spec.warpDensityLoom,
    fabric?.weftLoomDensity ?? spec.weftDensityLoom,
    spec.warpShrinkPct,
    spec.weftShrinkPct,
  );
  const wPos = opts.warpPositions ?? fabric!.warp.finished;
  const fPos = opts.weftPositions ?? fabric!.weft.finished;

  // --- iplikler (pencere + kenarlarda taşan) ---
  const wr = wPos.indexRange(view.x0Mm, view.x0Mm + view.widthMm);
  const fr = fPos.indexRange(view.y0Mm, view.y0Mm + view.heightMm);
  const nW = wr.count;
  const nF = fr.count;
  const wt = slotTable(spec.warpSlots);
  const ft = slotTable(spec.weftSlots);
  const wi = slotIndices(spec.warpSequence, wr.first, nW, spec.warpSlots.length);
  const fi = slotIndices(spec.weftSequence, fr.first, nF, spec.weftSlots.length);
  const xc = wPos.centers(wr.first, nW);
  const yc = fPos.centers(fr.first, nF);
  const rw = new Float64Array(nW);
  const rf = new Float64Array(nF);
  for (let k = 0; k < nW; k++) rw[k] = wt.diameter[wi[k]] / 2;
  for (let k = 0; k < nF; k++) rf[k] = ft.diameter[fi[k]] / 2;
  const rtW = racetrack(xc, rw);
  const rtF = racetrack(yc, rf);

  const phw = new Float64Array(nW);
  const tw = new Float64Array(nW);
  for (let k = 0; k < nW; k++) {
    phw[k] = rnd.warpPhase(wr.first + k);
    tw[k] = rnd.warpTone(wr.first + k);
  }
  const phf = new Float64Array(nF);
  const tf = new Float64Array(nF);
  for (let k = 0; k < nF; k++) {
    phf[k] = rnd.weftPhase(fr.first + k);
    tf[k] = rnd.weftTone(fr.first + k);
  }

  // --- piksel ızgarası ---
  const W = Math.max(1, Math.trunc(view.widthMm * ppm));
  const H = Math.max(1, Math.trunc(view.heightMm * ppm));
  const N = W * H;
  const beta = spec.warpCrimpShare ?? 0.4;
  const rMedW = median(rw) * ppm;
  const fibW = rnd.fiber(0.38 * rMedW, 0.1 * rMedW);
  const fibF = rnd.fiber(0.1 * rMedW, 0.38 * rMedW);
  // Gürültüyü kumaşa sabitle: pencere kaydırılınca doku da kayar
  const pxX0 = Math.round(view.x0Mm * ppm);
  const pxY0 = Math.round(view.y0Mm * ppm);

  let rwMax = 0;
  for (let k = 0; k < nW; k++) rwMax = Math.max(rwMax, rw[k]);
  let rfMax = 0;
  for (let k = 0; k < nF; k++) rfMax = Math.max(rfMax, rf[k]);
  const bg = -(rwMax + rfMax) * 1.4;

  const geomOnly = !!opts.debug?.geometryOnly;
  const wob = geomOnly ? 0 : WOBBLE;
  const plyK = geomOnly ? 0 : 0.42;
  const fibK = geomOnly ? 0 : 0.02;
  const topId = opts.debug?.collect ? new Int32Array(N) : null;
  const Hm = new Float32Array(N);
  const Hpx = new Float32Array(N);
  const isBg = new Uint8Array(N);
  const baseR = new Float32Array(N);
  const baseG = new Float32Array(N);
  const baseB = new Float32Array(N);
  let hMax = -Infinity;
  let bgCount = 0;

  for (let yy = 0; yy < H; yy++) {
    // alttan yukarı; referans piksel koordinatlarını float32 tutar (np.mgrid ... astype(float32))
    const Y = view.y0Mm + Math.fround((H - 1 - yy) / ppm);
    const j = nearestIndex(yc, Y);
    const [k0, f] = interval(yc, Y);
    const gF = fr.first + j;
    const jRow = pmod(gF, Rr) * Rc;
    const row0 = pmod(fr.first + k0, Rr) * Rc;
    const row1 = pmod(fr.first + k0 + 1, Rr) * Rc;
    const rfj = rf[j];
    const aFL = rtF.aLow[j];
    const aFH = rtF.aHigh[j];
    const aFM = (aFL + aFH) / 2;
    const bF = rtF.b[j];
    const slotF = fi[j];
    const twF = ft.twistSign[slotF];
    const colF = ft.rgb[slotF];
    for (let xx = 0; xx < W; xx++) {
      const X = view.x0Mm + Math.fround(xx / ppm);
      const o = yy * W + xx;

      // --- çözgü ---
      const i = nearestIndex(xc, X);
      const gW = wr.first + i;
      const icol = pmod(gW, Rc);
      const dx = X - (xc[i] + wob * Math.sin(Y * 2.1 + phw[i]));
      const dy = Y - (yc[j] + wob * Math.sin(X * 2.3 + phf[j]));
      const rwi = rw[i];
      // Racetrack: değilen taraftan yassılma; o atkıda komşu da aynı durumdaysa (flotte yan yana)
      // tam, değilse yarı yassılma.
      const upW = flat(M, Rc, jRow + icol);
      const nbW = dx < 0 ? flat(M, Rc, jRow + pmod(gW - 1, Rc)) : flat(M, Rc, jRow + pmod(gW + 1, Rc));
      const aWraw = dx < 0 ? rtW.aLow[i] : rtW.aHigh[i];
      const aW = rwi - (rwi - aWraw) * (nbW === upW ? 1 : 0.5);
      const aWM = (rtW.aLow[i] + rtW.aHigh[i]) / 2;
      const bW = rtW.b[i];
      // Atkı: alt/üst komşu atkıyla aynı sütunda aynı durumda mı
      const upF = !upW;
      const nbF = dy < 0 ? !flat(M, Rc, pmod(gF - 1, Rr) * Rc + icol) : !flat(M, Rc, pmod(gF + 1, Rr) * Rc + icol);
      const aFraw = dy < 0 ? aFL : aFH;
      const aF = rfj - (rfj - aFraw) * (nbF === upF ? 1 : 0.5);

      const D = rwi + rfj;
      const s0 = flat(M, Rc, row0 + icol) ? 1 : -1;
      const s1 = flat(M, Rc, row1 + icol) ? 1 : -1;
      const waveW = (s0 * (1 - f) + s1 * f) * D * beta;
      const [k2, f2] = interval(xc, X);
      const q0 = flat(M, Rc, jRow + pmod(wr.first + k2, Rc)) ? -1 : 1;
      const q1 = flat(M, Rc, jRow + pmod(wr.first + k2 + 1, Rc)) ? -1 : 1;
      const waveF = (q0 * (1 - f2) + q1 * f2) * D * (1 - beta);

      // --- büküm (2 kat), adım 1.5r ---
      const slotW = wi[i];
      const plyW = ply(Y, ((dx / aW) * wt.twistSign[slotW]), rwi);
      const plyF = ply(X, ((-dy / aF) * twF), rfj);

      const px = pxX0 + xx;
      const py = yy - (H - 1) - pxY0; // kumaşa sabit (−round(Y·ppm)), aşağı artan
      const fnW = fibW(px, py);
      const fnF = fibF(px, py);

      const covW = Math.abs(dx) < aW;
      const covF = Math.abs(dy) < aF;
      const HwV = covW ? waveW + prof(dx, aW, aWM, bW) + plyK * rwi * plyW + fibK * rwi * fnW : -1e3;
      const HfV = covF ? waveF + prof(dy, aF, aFM, bF) + plyK * rfj * plyF + fibK * rfj * fnF : -1e3;
      const topW = HwV >= HfV;
      const h = Math.max(HwV, HfV, bg);
      Hm[o] = h;
      if (topId) topId[o] = h <= bg + 1e-6 ? 0 : HwV >= HfV ? gW + 1 : -(gF + 1);
      Hpx[o] = h * ppm;
      if (h > hMax) hMax = h;
      if (h <= bg + 1e-6) {
        isBg[o] = 1;
        bgCount++;
      }

      let cr: number, cg: number, cb: number, pv: number, fv: number;
      if (topW) {
        const c = wt.rgb[slotW];
        const v = tw[i];
        cr = c[0] * v;
        cg = c[1] * v;
        cb = c[2] * v;
        pv = plyW;
        fv = fnW;
      } else {
        const v = tf[j];
        cr = colF[0] * v;
        cg = colF[1] * v;
        cb = colF[2] * v;
        pv = plyF;
        fv = fnF;
      }
      const m = (0.8 + 0.2 * pv) * (1 + 0.08 * fv);
      baseR[o] = cr * m;
      baseG[o] = cg * m;
      baseB[o] = cb * m;
    }
  }

  // --- ışık, gölge, AO ---
  const allR = new Float64Array(nW + nF);
  allR.set(rw, 0);
  allR.set(rf, nW);
  const rPx = median(allR) * ppm;

  const Hs = gaussianBlur(Hpx, W, H, 0.05 * rPx);
  const diff = new Float32Array(N);
  const spec_ = new Float32Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [gx, gyRaw] = gradientAt(Hs, W, H, x, y);
      let nx = -gx;
      let ny = gyRaw; // gy = −gy; ny = −gy
      let nz = 1;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= nl;
      ny /= nl;
      nz /= nl;
      const o = y * W + x;
      diff[o] = Math.min(Math.max(nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2], 0), 1);
      spec_[o] = Math.min(Math.max(nx * HALF[0] + ny * HALF[1] + nz * HALF[2], 0), 1) ** 18;
    }
  }

  const steps = Math.max(6, Math.trunc(rPx));
  const shadowRaw = new Float32Array(N).fill(1);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = y * W + x;
      const hc = Hpx[o];
      let s = 1;
      for (let k = 1; k < steps; k++) {
        const sy = pmod(y - k, H);
        const sx = pmod(x - k, W);
        if (Hpx[sy * W + sx] > hc + k * 1.1) {
          const v = 0.35 + (0.6 * k) / steps;
          if (v < s) s = v;
        }
      }
      shadowRaw[o] = s;
    }
  }
  const shadow = gaussianBlur(shadowRaw, W, H, 0.09 * rPx);
  const blur = gaussianBlur(Hpx, W, H, 0.3 * rPx);

  // --- birleştirme ---
  const out = new Uint8ClampedArray(N * 4);
  const gamma = 1 / 1.1;
  const hDen = hMax - bg + 1e-9;
  for (let o = 0; o < N; o++) {
    let r: number, g: number, b: number;
    if (isBg[o]) {
      [r, g, b] = BG_RGB;
    } else {
      const hn = (Hm[o] - bg) / hDen;
      const ao = Math.min(Math.max(0.3 + 0.85 * hn, 0.18), 1);
      const cav = Math.min(Math.max(1 - Math.max(blur[o] - Hpx[o], 0) / (0.9 * rPx), 0.35), 1);
      const light = (0.18 + 0.8 * diff[o]) * shadow[o] * ao * cav;
      const lum = (baseR[o] + baseG[o] + baseB[o]) / 3;
      const sp = 0.1 * (1 - 0.6 * lum) * spec_[o] * shadow[o];
      r = baseR[o] * light + sp;
      g = baseG[o] * light + sp;
      b = baseB[o] * light + sp;
      r = (r / (1 + 0.35 * r)) * 1.35;
      g = (g / (1 + 0.35 * g)) * 1.35;
      b = (b / (1 + 0.35 * b)) * 1.35;
    }
    const j4 = o * 4;
    out[j4] = Math.floor(Math.min(Math.max(r, 0), 1) ** gamma * 255);
    out[j4 + 1] = Math.floor(Math.min(Math.max(g, 0), 1) ** gamma * 255);
    out[j4 + 2] = Math.floor(Math.min(Math.max(b, 0), 1) ** gamma * 255);
    out[j4 + 3] = 255;
  }

  if (opts.scaleBar !== false) drawScaleBar(out, W, H, ppm);

  return {
    image: { width: W, height: H, data: out },
    openPct: (100 * bgCount) / N,
    Dw,
    Df,
    jammedWarp: rtW.jammed,
    jammedWeft: rtF.jammed,
    warpSlotsUsed: wi,
    ...(topId ? { debug: { height: Hm, topId } } : {}),
    weftSlotsUsed: fi,
  };
}

function flat(M: boolean[][], Rc: number, idx: number): boolean {
  return M[(idx / Rc) | 0][idx % Rc];
}

/**
 * Racetrack kesit profili (Love 1954; dikey düz kenarlı, alan korunur).
 * aSide: o taraftaki yarı genişlik, aMean: ortalama yarı genişlik, b: yarı yükseklik.
 * Sıkışma yoksa (a = b = r) referansın 0.6·r·√(1−u²) profiline eşittir.
 */
function prof(d: number, aSide: number, aMean: number, b: number): number {
  const u = Math.min(Math.abs(d) / aSide, 1);
  return 0.6 * (b - aMean + aMean * Math.sqrt(1 - u * u));
}

export interface RacetrackSet {
  /** Alt/sol taraf yarı genişliği (komşu k−1 yönü). */
  aLow: Float64Array;
  /** Üst/sağ taraf yarı genişliği (komşu k+1 yönü). */
  aHigh: Float64Array;
  /** Alan korunumundan yarı yükseklik. */
  b: Float64Array;
  jammed: boolean;
}

/**
 * Komşu aralığı yarıçap oranında paylaştırılır; ipliğin o taraftaki yarı genişliği bu payla sınırlanır.
 * Kesit alanı korunur: πa² + 4a(b − a) = πr² (a = ortalama yarı genişlik) → b.
 */
export function racetrack(centers: Float64Array, radii: Float64Array): RacetrackSet {
  const n = centers.length;
  const aLow = new Float64Array(n);
  const aHigh = new Float64Array(n);
  const b = new Float64Array(n);
  let jammed = false;
  for (let k = 0; k < n; k++) {
    aLow[k] = radii[k];
    aHigh[k] = radii[k];
  }
  for (let k = 0; k < n - 1; k++) {
    const gap = centers[k + 1] - centers[k];
    const need = radii[k] + radii[k + 1];
    if (gap < MIN_SQUEEZE * need) jammed = true;
    if (gap < need) {
      aHigh[k] = Math.min(aHigh[k], (gap * radii[k]) / need);
      aLow[k + 1] = Math.min(aLow[k + 1], (gap * radii[k + 1]) / need);
    }
  }
  for (let k = 0; k < n; k++) b[k] = racetrackHalfHeight(radii[k], (aLow[k] + aHigh[k]) / 2);
  return { aLow, aHigh, b, jammed };
}

/** πa² + 4a(b − a) = πr² → b = a + π(r² − a²)/(4a). */
export function racetrackHalfHeight(r: number, a: number): number {
  if (a >= r) return r;
  return a + (Math.PI * (r * r - a * a)) / (4 * a);
}

function ply(u: number, v: number, r: number): number {
  const pitch = 1.5 * r;
  const ph = (u + v * r * 1.3) / pitch;
  return Math.sqrt(Math.abs(Math.sin(Math.PI * ph)));
}

/** Referanstaki PIL dikdörtgeni: [12, N−30, 12+ppm, N−24] uçlar dahil, (240,240,240). */
function drawScaleBar(out: Uint8ClampedArray, W: number, H: number, ppm: number): void {
  const bar = Math.trunc(ppm);
  for (let y = H - 30; y <= H - 24; y++) {
    if (y < 0 || y >= H) continue;
    for (let x = 12; x <= 12 + bar; x++) {
      if (x < 0 || x >= W) continue;
      const o = (y * W + x) * 4;
      out[o] = 240;
      out[o + 1] = 240;
      out[o + 2] = 240;
    }
  }
}
