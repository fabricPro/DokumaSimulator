/**
 * Gerçekçi renderer — geçiş zinciri:
 *   Faz 1 'flat'    : matristen düz renk (doğrulama görünümü)
 *   Faz 2 'preview' : G-buffer (MRT) → basit Lambert önizleme
 *   'lit' (varsayılan, fix-v2 adım 2 önbellekli):
 *     PİŞİRME (desen / iplik / ışık / ayar / kalite değişince, tek döşeme için bir kez — tile.ts):
 *       döşeme G-buffer'ı → AO + gölge döşemesi (sarmalı) → tüy katmanı (CPU, hair.ts)
 *       mobil profilde ayrıca: tüm ışıklı sahne döşemeye
 *     HER KARE (pan / zoom yalnız okur):
 *       masaüstü: ekran G-buffer'ı (keskin geometri, kat, lif) → ışık (ao / gölge / tüy döşemeden)
 *       mobil   : yalnız döşenmiş renk dokusu
 */
import { createProgram, createTexture, hasRequiredExtensions, type AnyCanvas } from './gl/context';
import { FLAT_FS, FULLSCREEN_VS } from './gl/shaders/flat.glsl';
import { GBUFFER_FS, PREVIEW_FS } from './gl/shaders/gbuffer.glsl';
import { LIT_FS, OCCLUSION_FS, TILE_FS, VIEW_FS } from './gl/shaders/lit.glsl';
import { viewBakeDensity, viewBlurMm } from './viewDistance';
import { EXPOSURE, LUSTER_KK_MUL, LUSTER_ORDER, QUALITY_SAMPLES } from './surface';
import { bakeFiberNoise, FIBER_TEX_SIZE, FIBER_TEXELS_PER_D } from './fiberNoise';
import { crossingTable, geometryParamsFromInput, v2BgHeight, V2_CRIMP_SHARE } from './geometry';
import { PLY_K } from './relief';
import { generateHair } from './hair';
import { resolveIrregularity } from './irregularity';
import { packFabric, threadColors, threadTable, type PackedFabric } from './pack';
import { pitchMm } from './scale';
import { bakeDensity, snapFreq, tileFor, type TileInfo } from './tile';
import type { FabricInput, RealisticRenderer, RendererOptions, RenderStats, ViewParams } from './types';

interface Uploaded {
  input: FabricInput;
  version: number;
  packed: PackedFabric;
  bgHeight: number;
  heightRange: number;
  rMax: number;
  tile: TileInfo;
  weave: WebGLTexture;
  warpColor: WebGLTexture;
  weftColor: WebGLTexture;
  warpType: WebGLTexture;
  weftType: WebGLTexture;
  yarnTypes: WebGLTexture;
  /** v2 kesişim z tablosu (RG32F) + iplik tablosu (RGBA32F, pack.ts threadTable); anahtar: düzensizlik / basıklık. */
  cross: { key: string; tex: WebGLTexture; threads: WebGLTexture; colors: WebGLTexture; halfWidthMax: number } | null;
}

interface GBuffer {
  fbo: WebGLFramebuffer;
  gb0: WebGLTexture;
  gb1: WebGLTexture;
  /** (kat, ince lif, lif gürültüsü, yükseklik / r_ref), mip'li — AO kutu ortalaması için. */
  gb2: WebGLTexture;
  /** Alt katman (fix-v3). */
  gb3: WebGLTexture;
  width: number;
  height: number;
  float: boolean;
}

interface Bake {
  key: string;
  tile: TileInfo;
  /** (ao, gölge) döşemesi. */
  occ: WebGLTexture;
  /** Mobil / Göz / Uzak: ışıklı sahne döşemesi (sRGB, mip'li). */
  color: WebGLTexture | null;
  size: [number, number];
  ms: number;
  /** Pişirilen bölge (mm): tüm döşeme ya da (lup, uzun rapor) görünür pencere. */
  origin: [number, number];
  span: [number, number];
  windowed: boolean;
  /** texel / mm. */
  density: number;
}

interface HairBake {
  key: string;
  tex: WebGLTexture;
  strokes: number;
  ms: number;
}

/** Zemin yüksekliği: kalınlık düzensizliği kadar büyütülür (geometry.ts ile aynı). */
function bgHeightFor(t: { bgHeight: number }, thickness: number): number {
  return t.bgHeight * (1 + thickness);
}

/** Işık yönü: azimut 0° = sağdan (+x), 90° = üstten (+y); yükseklik 90° = tepeden. */
export function lightDirection(azimuthDeg: number, elevationDeg: number): [number, number, number] {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  return [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
}

/** Tüy katmanı yoğunluğu (texel / mm) üst sınırı ve çizgi kalınlığı (mm; prototipte 0.5 px @128 px/mm). */
const HAIR_TEXELS_PER_MM_MAX = 128;
const HAIR_WIDTH_MM = 0.004;

export function createRealisticRenderer(canvas: AnyCanvas, opts: RendererOptions = {}): RealisticRenderer {
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: !!opts.preserveDrawingBuffer,
  }) as WebGL2RenderingContext | null;
  if (!gl) throw new Error('WebGL2 desteklenmiyor.');
  const ext = hasRequiredExtensions(gl);
  if (!ext.float && !ext.halfFloat) throw new Error('Float render hedefi desteklenmiyor.');
  const view = opts.debugView ?? 'lit';
  const profile = opts.profile ?? 'desktop';
  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  // VARSAYIM: masaüstü döşeme kenarı ≤ 4096, mobil ≤ 2048 (bellek)
  const bakeMaxSide = Math.min(maxTex, profile === 'mobile' ? 2048 : 4096);

  // Faz 6: bağlam kaybı ve kare süresi ölçümü
  let contextLost = false;
  const onLost = () => {
    contextLost = true;
    opts.onContextLost?.();
  };
  if ('addEventListener' in canvas) canvas.addEventListener('webglcontextlost', onLost as EventListener);
  const wantMeasure = opts.measure ?? 'none';
  const timerExt =
    wantMeasure === 'auto' || wantMeasure === 'timer'
      ? (gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null)
      : null;
  const method: RenderStats['method'] =
    wantMeasure === 'none' ? 'none' : timerExt ? 'timer' : wantMeasure === 'timer' ? 'none' : 'sync';
  let pendingQuery: WebGLQuery | null = null;
  let gpuMs: number | null = null;
  const pollQuery = () => {
    if (!pendingQuery || !timerExt) return;
    if (!gl.getQueryParameter(pendingQuery, gl.QUERY_RESULT_AVAILABLE)) return;
    const disjoint = gl.getParameter(timerExt.GPU_DISJOINT_EXT);
    if (!disjoint) gpuMs = (gl.getQueryParameter(pendingQuery, gl.QUERY_RESULT) as number) / 1e6;
    gl.deleteQuery(pendingQuery);
    pendingQuery = null;
  };
  const syncPixel = new Uint8Array(4);

  const flatProg = createProgram(gl, FULLSCREEN_VS, FLAT_FS);
  const gbProg = createProgram(gl, FULLSCREEN_VS, GBUFFER_FS);
  const prevProg = createProgram(gl, FULLSCREEN_VS, PREVIEW_FS);
  const occProg = createProgram(gl, FULLSCREEN_VS, OCCLUSION_FS);
  const litProg = createProgram(gl, FULLSCREEN_VS, LIT_FS);
  const tileProg = createProgram(gl, FULLSCREEN_VS, TILE_FS);
  const viewProg = createProgram(gl, FULLSCREEN_VS, VIEW_FS);
  const vao = gl.createVertexArray();
  const uniforms = (p: WebGLProgram) => (n: string) => gl.getUniformLocation(p, n);
  const uf = uniforms(flatProg);
  const ug = uniforms(gbProg);
  const up = uniforms(prevProg);
  const uo = uniforms(occProg);
  const ul = uniforms(litProg);
  const ut = uniforms(tileProg);
  const uv = uniforms(viewProg);
  let tex: Uploaded | null = null;
  let gbuf: GBuffer | null = null;
  let bake: Bake | null = null;
  let hair: HairBake | null = null;
  let inputVersion = 0;
  let lastBakeMs: number | null = null;
  let disposed = false;

  // Lif gürültüsü — renderer başına bir kez (deterministik)
  const fiberTex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, fiberTex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, FIBER_TEX_SIZE, FIBER_TEX_SIZE, 0, gl.RED, gl.FLOAT, bakeFiberNoise());
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.generateMipmap(gl.TEXTURE_2D);
  // Anizotropik süzgeç (varsa): boyunca uzamış lif gürültüsü uzak / eğik bakışta bulanmaz, moiré oluşmaz
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic') as
    | { TEXTURE_MAX_ANISOTROPY_EXT: number; MAX_TEXTURE_MAX_ANISOTROPY_EXT: number }
    | null;
  if (aniso) {
    const maxA = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number;
    gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, maxA));
  }

  // Tüy kapalıyken bağlanacak boş doku
  const emptyTex = createTexture(gl, gl.RGBA8, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));

  const freeTextures = () => {
    if (!tex) return;
    for (const t of [tex.weave, tex.warpColor, tex.weftColor, tex.warpType, tex.weftType, tex.yarnTypes]) gl.deleteTexture(t);
    if (tex.cross) for (const x of [tex.cross.tex, tex.cross.threads, tex.cross.colors]) gl.deleteTexture(x);
    tex = null;
  };
  const freeGB = (g: GBuffer) => {
    gl.deleteFramebuffer(g.fbo);
    gl.deleteTexture(g.gb0);
    gl.deleteTexture(g.gb1);
    gl.deleteTexture(g.gb2);
    gl.deleteTexture(g.gb3);
  };
  const freeBake = () => {
    if (!bake) return;
    gl.deleteTexture(bake.occ);
    if (bake.color) gl.deleteTexture(bake.color);
    bake = null;
  };
  const freeHair = () => {
    if (!hair) return;
    gl.deleteTexture(hair.tex);
    hair = null;
  };

  const upload = (input: FabricInput): Uploaded => {
    if (tex && tex.input === input) return tex;
    freeTextures();
    const p = packFabric(input);
    const g = geometryParamsFromInput(input, 1, 0); // düzensizliksiz taban; kalınlık payı render'da eklenir
    let rMax = 0;
    for (let k = 0; k < p.counts.yarnTypes; k++) rMax = Math.max(rMax, p.yarnTypes[k * 4] / 2);
    inputVersion++;
    tex = {
      input,
      version: inputVersion,
      packed: p,
      bgHeight: g.bgHeight,
      heightRange: Math.max(1e-6, -g.bgHeight + rMax * 2),
      rMax,
      tile: tileFor(input),
      weave: createTexture(gl, gl.R8UI, p.weave.width, p.weave.height, gl.RED_INTEGER, gl.UNSIGNED_BYTE, p.weave.data),
      warpColor: createTexture(gl, gl.RGBA8, p.counts.warp, 1, gl.RGBA, gl.UNSIGNED_BYTE, p.warpColors),
      weftColor: createTexture(gl, gl.RGBA8, p.counts.weft, 1, gl.RGBA, gl.UNSIGNED_BYTE, p.weftColors),
      warpType: createTexture(gl, gl.R8UI, p.counts.warp, 1, gl.RED_INTEGER, gl.UNSIGNED_BYTE, p.warpTypes),
      weftType: createTexture(gl, gl.R8UI, p.counts.weft, 1, gl.RED_INTEGER, gl.UNSIGNED_BYTE, p.weftTypes),
      yarnTypes: createTexture(gl, gl.RGBA32F, p.counts.yarnTypes, 2, gl.RGBA, gl.FLOAT, p.yarnTypes),
      cross: null,
    };
    return tex;
  };

  /** G-buffer hedefi. `half`: pişirmede bellek için RGBA16F; `repeat`: döşemede sarmalı örnekleme. */
  const makeGBuffer = (w: number, h: number, half: boolean, repeat: boolean): GBuffer => {
    const useFloat = ext.float && !half;
    const fmt = useFloat ? gl.RGBA32F : gl.RGBA16F;
    const type = useFloat ? gl.FLOAT : gl.HALF_FLOAT;
    const gb0 = createTexture(gl, fmt, w, h, gl.RGBA, type, null);
    const gb1 = createTexture(gl, fmt, w, h, gl.RGBA, type, null);
    const gb3 = createTexture(gl, gl.RGBA16F, w, h, gl.RGBA, gl.HALF_FLOAT, null);
    const gb2 = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, gb2);
    const levels = Math.floor(Math.log2(Math.max(w, h))) + 1;
    gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA16F, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, gb0, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, gb1, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, gb2, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT3, gl.TEXTURE_2D, gb3, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2, gl.COLOR_ATTACHMENT3]);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error('G-buffer oluşturulamadı: ' + status);
    return { fbo, gb0, gb1, gb2, gb3, width: w, height: h, float: useFloat };
  };

  const ensureGBuffer = (w: number, h: number): GBuffer => {
    if (gbuf && gbuf.width === w && gbuf.height === h) return gbuf;
    if (gbuf) freeGB(gbuf);
    gbuf = makeGBuffer(w, h, false, false);
    return gbuf;
  };

  /** Doğrusal süzgeçli, sarmalı RGBA8 hedef (döşeme). */
  /** `srgb`: renk döşemesi SRGB8_ALPHA8 (mip ortalaması ve örnekleme doğrusal uzayda). */
  const makeTarget = (w: number, h: number, mip: boolean, srgb = false): { tex: WebGLTexture; fbo: WebGLFramebuffer } => {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (mip) gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(Math.max(w, h))) + 1, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, w, h);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex: t, fbo };
  };

  const bindTex = (unit: number, t: WebGLTexture, l: WebGLUniformLocation | null) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.uniform1i(l, unit);
  };

  const commonUniforms = (u: (n: string) => WebGLUniformLocation | null, t: Uploaded, input: FabricInput, v: ViewParams) => {
    gl.uniform2i(u('uWeaveSize'), t.packed.weave.width, t.packed.weave.height);
    gl.uniform1i(u('uWarpCount'), t.packed.counts.warp);
    gl.uniform1i(u('uWeftCount'), t.packed.counts.weft);
    gl.uniform2f(u('uPitchMm'), pitchMm(input.density.warpPerCm), pitchMm(input.density.weftPerCm));
    gl.uniform2f(u('uOffsetMm'), v.offsetCm[0] * 10, v.offsetCm[1] * 10);
    gl.uniform1f(u('uPxPerMm'), v.pxPerCm / 10);
  };

  /** v2 kesişim z tablosu (temas modeli) ve iplik tablosu: girdi / düzensizlik / basıklık değişince bir kez CPU'da. */
  const ensureCross = (t: Uploaded, input: FabricInput, v: ViewParams): NonNullable<Uploaded['cross']> => {
    const irr = v.tuning?.irregularity ?? 1;
    const fl = v.tuning?.flattening ?? 1;
    const sp = v.tuning?.spread ?? 1;
    const key = `${irr}|${fl}|${sp}`;
    if (t.cross && t.cross.key === key) return t.cross;
    if (t.cross) for (const x of [t.cross.tex, t.cross.threads, t.cross.colors]) gl.deleteTexture(x);
    const [px, py] = t.tile.threads;
    const data = crossingTable(geometryParamsFromInput(input, fl, irr, 'v2', sp), px, py);
    const cx = createTexture(gl, gl.RG32F, px, py, gl.RG, gl.FLOAT, data);
    const th = threadTable(input, [px, py], irr, fl, sp);
    const tt = createTexture(gl, gl.RGBA32F, th.width, 8, gl.RGBA, gl.FLOAT, th.data);
    // En geniş kesit yarı genişliği a = r·√k (satır 0 / 4: (r, kayma, k, d))
    let halfWidthMax = 0;
    for (const row of [0, 4]) {
      for (let i = 0; i < th.width; i++) {
        const o = (row * th.width + i) * 4;
        halfWidthMax = Math.max(halfWidthMax, th.data[o] * Math.sqrt(th.data[o + 2]) + Math.abs(th.data[o + 1]));
      }
    }
    const tc = threadColors(input, [px, py], irr);
    const colors = createTexture(gl, gl.RGBA32F, tc.width, 2, gl.RGBA, gl.FLOAT, tc.data);
    t.cross = { key, tex: cx, threads: tt, colors, halfWidthMax };
    return t.cross;
  };

  /**
   * G-buffer geçişi verilen hedefe. ppmXY: px/mm (x, y) — döşemede kenara tam otursun diye ayrı.
   * mip: gb2 mip zinciri (yalnız pişirmede AO kutu ortalaması için; ekranda her karede gereksiz).
   */
  const drawGBuffer = (
    t: Uploaded,
    input: FabricInput,
    v: ViewParams,
    g: GBuffer,
    ppmXY: [number, number],
    offsetMm: [number, number],
    mip = false,
  ) => {
    const v2 = (v.tuning?.model ?? 'v2') === 'v2';
    const cr = v2 ? ensureCross(t, input, v) : null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, g.fbo);
    gl.viewport(0, 0, g.width, g.height);
    gl.useProgram(gbProg);
    gl.bindVertexArray(vao);
    bindTex(0, t.weave, ug('uWeave'));
    bindTex(1, t.warpType, ug('uWarpType'));
    bindTex(2, t.weftType, ug('uWeftType'));
    bindTex(3, t.yarnTypes, ug('uYarnTypes'));
    bindTex(4, fiberTex, ug('uFiber'));
    bindTex(5, cr?.tex ?? emptyTex, ug('uCross'));
    bindTex(6, cr?.threads ?? emptyTex, ug('uThreads'));
    // iplik boyunca frekanslar döşemeye tam periyot (shader eskiden her pikselde snapF ile hesaplıyordu)
    const [Px, Py] = t.tile.threads;
    gl.uniform4f(ug('uFreqW'), snapFreq(0.45, Py), snapFreq(0.13, Py), snapFreq(0.9, Py), snapFreq(0.31, Py));
    gl.uniform3f(ug('uFreqF'), snapFreq(0.45, Px), snapFreq(0.13, Px), snapFreq(0.7, Px));
    // En geniş kesit (+ boyunca kalınlık %7, yol sapması ≤ 0.09·p, AA yarım pikseli) en küçük aralığı aşarsa 4 aday
    const pMin = Math.min(pitchMm(input.density.warpPerCm), pitchMm(input.density.weftPerCm));
    const halfW = (cr?.halfWidthMax ?? 0) * 1.07 + 0.09 * pMin + 1 / Math.min(ppmXY[0], ppmXY[1]);
    gl.uniform1i(ug('uSpan'), halfW < pMin ? 1 : 2);
    commonUniforms(ug, t, input, v);
    gl.uniform1i(ug('uLayered'), opts.singleLayer ? 0 : 1);
    gl.uniform1f(ug('uPlyK'), PLY_K);
    gl.uniform2f(ug('uOffsetMm'), offsetMm[0], offsetMm[1]);
    gl.uniform1f(ug('uPxPerMm'), Math.sqrt(ppmXY[0] * ppmXY[1]));
    gl.uniform2f(ug('uPxPerMmXY'), ppmXY[0], ppmXY[1]);
    gl.uniform2i(ug('uPeriod'), t.tile.threads[0], t.tile.threads[1]);
    gl.uniform2f(ug('uTileMm'), t.tile.mm[0], t.tile.mm[1]);
    gl.uniform1i(ug('uModel'), v2 ? 1 : 0);
    gl.uniform1f(ug('uRelief'), v.tuning?.relief ?? 1);
    gl.uniform1f(ug('uAlongMul'), Math.max(0, v.tuning?.irregularity ?? 1));
    gl.uniform1f(ug('uRRef'), t.rMax);
    gl.uniform1f(ug('uFiberTexelsPerD'), FIBER_TEXELS_PER_D);
    gl.uniform1f(ug('uFiberSize'), FIBER_TEX_SIZE);
    gl.uniform1f(ug('uCrimpShare'), input.crimpShare ?? 0.4);
    gl.uniform1f(ug('uFlatten'), v.tuning?.flattening ?? 1);
    const ir = resolveIrregularity(input, v.tuning?.irregularity ?? 1);
    gl.uniform1f(ug('uBgHeight'), v2 ? v2BgHeight(t.rMax * (1 + ir.thickness), input.crimpShare ?? V2_CRIMP_SHARE) : bgHeightFor(t, ir.thickness));
    gl.uniform1ui(ug('uSeed'), ir.seed);
    gl.uniform1f(ug('uThick'), ir.thickness);
    gl.uniform1f(ug('uPos'), ir.position);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (mip) {
      gl.bindTexture(gl.TEXTURE_2D, g.gb2);
      gl.generateMipmap(gl.TEXTURE_2D);
    }
  };

  /** Işık geçişi: verilen G-buffer + pişirilmiş döşemeler → hedef (null = ekran). */
  const drawLit = (
    t: Uploaded,
    input: FabricInput,
    v: ViewParams,
    g: GBuffer,
    b: Bake,
    hairTex: WebGLTexture | null,
    target: WebGLFramebuffer | null,
    ppmXY: [number, number],
    offsetMm: [number, number],
  ) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(0, 0, g.width, g.height);
    gl.useProgram(litProg);
    gl.bindVertexArray(vao);
    bindTex(0, g.gb0, ul('uGb0'));
    bindTex(1, g.gb1, ul('uGb1'));
    bindTex(2, b.occ, ul('uOccTile'));
    gl.uniform1i(ul('uOccWindowed'), b.windowed ? 1 : 0);
    gl.uniform2f(ul('uOccOrigin'), b.origin[0], b.origin[1]);
    gl.uniform2f(ul('uOccSpan'), b.span[0], b.span[1]);
    gl.uniform1i(ul('uLinearOut'), target ? 1 : 0);
    bindTex(3, t.warpColor, ul('uWarpColor'));
    bindTex(4, t.weftColor, ul('uWeftColor'));
    bindTex(5, t.warpType, ul('uWarpType'));
    bindTex(6, t.weftType, ul('uWeftType'));
    bindTex(7, t.yarnTypes, ul('uYarnTypes'));
    bindTex(8, g.gb2, ul('uGb2'));
    bindTex(9, hairTex ?? emptyTex, ul('uHairTile'));
    bindTex(10, g.gb3, ul('uGb3'));
    const crl = ensureCross(t, input, v);
    bindTex(11, crl.colors, ul('uThreadColor'));
    bindTex(12, crl.threads, ul('uThreads'));
    gl.uniform1i(ul('uAnalyticN'), (v.tuning?.model ?? 'v2') === 'v2' ? 1 : 0);
    gl.uniform1f(ul('uWhite'), Math.max(1.05, v.tuning?.whitePoint ?? 2));
    const bg = v.tuning?.background ?? 'darkgray';
    gl.uniform1i(ul('uBg'), bg === 'black' ? 1 : bg === 'backlight' ? 2 : 0);
    gl.uniform1i(ul('uHairOn'), hairTex ? 1 : 0);
    gl.uniform1i(ul('uWarpCount'), t.packed.counts.warp);
    gl.uniform1i(ul('uWeftCount'), t.packed.counts.weft);
    gl.uniform2i(ul('uSize'), g.width, g.height);
    gl.uniform1f(ul('uPxPerMm'), Math.sqrt(ppmXY[0] * ppmXY[1]));
    gl.uniform2f(ul('uPxPerMmXY'), ppmXY[0], ppmXY[1]);
    gl.uniform2f(ul('uOffsetMm'), offsetMm[0], offsetMm[1]);
    gl.uniform2i(ul('uPeriod'), t.tile.threads[0], t.tile.threads[1]);
    gl.uniform2f(ul('uTileMm'), t.tile.mm[0], t.tile.mm[1]);
    gl.uniform3fv(ul('uLightDir'), lightDirection(v.light.azimuthDeg, v.light.elevationDeg));
    gl.uniform1fv(ul('uLusterMul'), LUSTER_ORDER.map((k) => LUSTER_KK_MUL[k]));
    gl.uniform1f(ul('uSpecMul'), v.tuning?.specularStrength ?? 1);
    gl.uniform1f(ul('uSpecWidthMul'), v.tuning?.specularWidth ?? 1);
    gl.uniform1f(ul('uExposure'), EXPOSURE);
    gl.uniform1f(ul('uMelange'), v.tuning?.melange ?? 1);
    const irl = resolveIrregularity(input, v.tuning?.irregularity ?? 1);
    gl.uniform1ui(ul('uSeed'), irl.seed);
    gl.uniform1f(ul('uColorDE'), irl.colorDeltaE);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  /** Tüy katmanı: lifler (CPU, deterministik) 2B tuvale çizilir → önçarpımlı RGBA8 döşeme. */
  const ensureHair = (t: Uploaded, input: FabricInput, v: ViewParams): WebGLTexture | null => {
    const mul = v.tuning?.hairiness ?? 1;
    const key = `${t.version}|${mul}|${input.seed ?? 1}`;
    if (hair && hair.key === key) return hair.tex;
    freeHair();
    const t0 = performance.now();
    const strokes = generateHair(input, t.tile, mul);
    const D = Math.min(HAIR_TEXELS_PER_MM_MAX, bakeMaxSide / Math.max(t.tile.mm[0], t.tile.mm[1]));
    const w = Math.max(8, Math.round(t.tile.mm[0] * D));
    const h = Math.max(8, Math.round(t.tile.mm[1] * D));
    const sx = w / t.tile.mm[0];
    const sy = h / t.tile.mm[1];
    const cv: OffscreenCanvas | HTMLCanvasElement =
      typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = cv.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return null;
    // Çizgi kalınlığı en az 1 texel; ince lif mürekkebi korunur: opaklık × gerçek / çizilen kalınlık
    const widthTex = HAIR_WIDTH_MM * Math.sqrt(sx * sy);
    ctx.lineWidth = Math.max(1, widthTex);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const ink = Math.min(1, widthTex) * 2.5; // VARSAYIM: prototipte ince (0.5 px) lif keskin görünür; geniş çizgide mürekkep ×2.5
    for (const s of strokes) {
      ctx.strokeStyle = s.color;
      ctx.globalAlpha = Math.min(1, s.alpha * ink);
      // döşeme kenarında sarmalama: kenara yakın lifler komşu kopyalara da çizilir
      const xs = s.pts.map((p) => p[0]);
      const ys = s.pts.map((p) => p[1]);
      const ox = [0];
      const oy = [0];
      if (Math.min(...xs) < 0) ox.push(t.tile.mm[0]);
      if (Math.max(...xs) > t.tile.mm[0]) ox.push(-t.tile.mm[0]);
      if (Math.min(...ys) < 0) oy.push(t.tile.mm[1]);
      if (Math.max(...ys) > t.tile.mm[1]) oy.push(-t.tile.mm[1]);
      for (const dx of ox) {
        for (const dy of oy) {
          ctx.beginPath();
          s.pts.forEach(([x, y], k) => {
            // tuval y aşağı; doku satır 0 = kumaş y 0 olsun diye UNPACK_FLIP_Y ile yüklenir
            const X = (x + dx) * sx;
            const Y = h - (y + dy) * sy;
            if (k === 0) ctx.moveTo(X, Y);
            else ctx.lineTo(X, Y);
          });
          ctx.stroke();
        }
      }
    }
    const tx = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tx);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, cv as TexImageSource);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.generateMipmap(gl.TEXTURE_2D);
    hair = { key, tex: tx, strokes: strokes.length, ms: performance.now() - t0 };
    return tx;
  };

  /**
   * Döşeme pişirme: anahtar değişmedikçe yeniden yapılmaz (pan / zoom anahtara girmez).
   *  - Lup (masaüstü): ao / gölge tüm döşemeye. Uzun raporda (LHOTSE ~40 cm) döşeme lup çözünürlüğüne sığmıyorsa
   *    yalnız görünür pencere (×2, kenar payı) pişirilir; görünüm pencereden çıkınca yeniden.
   *  - Göz / Uzak: tüm rapor DÜŞÜK çözünürlükte (filtre çekirdeğini çözecek kadar, ≤ 24 texel/mm) ışıklı renk
   *    döşemesine pişirilir; ekranda ön filtreyle gösterilir.
   *  - Mobil: tüm ışıklı sahne döşemeye (değişmedi).
   */
  const ensureBake = (t: Uploaded, input: FabricInput, v: ViewParams): Bake => {
    const q = QUALITY_SAMPLES[v.quality] ?? QUALITY_SAMPLES.medium;
    const tn = v.tuning ?? {};
    const distance = v.distance ?? 'loupe';
    const viewMode = distance !== 'loupe';
    const colorBake = profile === 'mobile' || viewMode;
    const tile = t.tile;
    const key = JSON.stringify([
      t.version,
      v.light.azimuthDeg,
      v.light.elevationDeg,
      v.quality,
      tn.aoStrength ?? 1,
      tn.irregularity ?? 1,
      tn.relief ?? 1,
      tn.model ?? 'v2',
      tn.flattening ?? 1,
      tn.spread ?? 1,
      tn.contactShadow ?? 1,
      distance,
      colorBake
        ? [tn.hairiness ?? 1, tn.specularStrength ?? 1, tn.specularWidth ?? 1, tn.melange ?? 1, tn.background ?? 'darkgray', tn.whitePoint ?? 2]
        : 0,
    ]);
    // Bölge ve yoğunluk
    let origin: [number, number] = [0, 0];
    let span: [number, number] = [tile.mm[0], tile.mm[1]];
    let windowed = false;
    let D: number;
    if (viewMode) {
      D = Math.min(viewBakeDensity(viewBlurMm(distance, input)), bakeMaxSide / Math.max(tile.mm[0], tile.mm[1]));
    } else if (profile === 'mobile') {
      D = bakeDensity(tile, input, bakeMaxSide, 16, 48);
    } else {
      D = bakeDensity(tile, input, bakeMaxSide, 16, 64);
      const want = bakeDensity(tile, input, Infinity, 16, 64);
      if (D < 0.6 * want) {
        // Görünür pencere (mm), kumaş koordinatında
        const ppm = v.pxPerCm / 10;
        const vx = v.offsetCm[0] * 10;
        const vy = v.offsetCm[1] * 10;
        const vw = canvas.width / ppm;
        const vh = canvas.height / ppm;
        if (bake && bake.key === key && bake.windowed && vx >= bake.origin[0] && vy >= bake.origin[1] &&
            vx + vw <= bake.origin[0] + bake.span[0] && vy + vh <= bake.origin[1] + bake.span[1]) {
          return bake;
        }
        windowed = true;
        D = want;
        const pMax = Math.max(pitchMm(input.density.warpPerCm), pitchMm(input.density.weftPerCm));
        span = [Math.max(2 * vw, 8 * pMax), Math.max(2 * vh, 8 * pMax)];
        D = Math.min(D, bakeMaxSide / Math.max(span[0], span[1]));
        // köken texel ızgarasına oturtulur (pencere değişince desen kaymasın)
        origin = [Math.floor((vx + vw / 2 - span[0] / 2) * D) / D, Math.floor((vy + vh / 2 - span[1] / 2) * D) / D];
      }
    }
    if (!windowed && bake && bake.key === key) return bake;
    freeBake();
    const t0 = performance.now();
    const w = Math.max(8, Math.round(span[0] * D));
    const h = Math.max(8, Math.round(span[1] * D));
    const ppmXY: [number, number] = [w / span[0], h / span[1]];
    const ppm = Math.sqrt(ppmXY[0] * ppmXY[1]);
    // 1) G-buffer (yarım hassasiyet; tüm döşemede sarmalı)
    const g = makeGBuffer(w, h, true, !windowed);
    drawGBuffer(t, input, v, g, ppmXY, origin, true);
    // 2) AO + gölge (döşemede sarmalı komşuluk, pencerede kenara kıskaç)
    const occ = makeTarget(w, h, false);
    gl.bindFramebuffer(gl.FRAMEBUFFER, occ.fbo);
    gl.viewport(0, 0, w, h);
    gl.useProgram(occProg);
    gl.bindVertexArray(vao);
    bindTex(0, g.gb0, uo('uGb0'));
    bindTex(1, g.gb2, uo('uGb2'));
    gl.uniform2i(uo('uSize'), w, h);
    gl.uniform1f(uo('uPxPerMm'), ppm);
    gl.uniform1f(uo('uPitchPx'), pitchMm(input.density.warpPerCm) * ppm);
    gl.uniform1i(uo('uAoScales'), q.ao);
    gl.uniform1f(uo('uAoStrength'), tn.aoStrength ?? 1);
    gl.uniform1i(uo('uShadowSteps'), q.shadow);
    gl.uniform3fv(uo('uLightDir'), lightDirection(v.light.azimuthDeg, v.light.elevationDeg));
    gl.uniform1f(uo('uRRef'), t.rMax);
    gl.uniform1i(uo('uWrap'), windowed ? 0 : 1);
    gl.uniform1f(uo('uContact'), tn.contactShadow ?? 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.deleteFramebuffer(occ.fbo);
    const b: Bake = { key, tile, occ: occ.tex, color: null, size: [w, h], ms: 0, origin, span, windowed, density: ppm };
    // 3) mobil / Göz / Uzak: tüm ışıklı sahne döşemeye (sRGB, mip'li)
    if (colorBake) {
      const hairTex = v.quality === 'high' ? ensureHair(t, input, v) : null;
      const col = makeTarget(w, h, true, true);
      drawLit(t, input, v, g, b, hairTex, col.fbo, ppmXY, [0, 0]);
      gl.bindTexture(gl.TEXTURE_2D, col.tex);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.deleteFramebuffer(col.fbo);
      b.color = col.tex;
    }
    freeGB(g);
    b.ms = performance.now() - t0;
    lastBakeMs = b.ms;
    bake = b;
    return b;
  };

  const renderScreenGBuffer = (input: FabricInput, v: ViewParams) => {
    const t = upload(input);
    const g = ensureGBuffer(canvas.width, canvas.height);
    const ppm = v.pxPerCm / 10;
    drawGBuffer(t, input, v, g, [ppm, ppm], [v.offsetCm[0] * 10, v.offsetCm[1] * 10]);
    return { t, g };
  };

  const api = {
    draw(input: FabricInput, v: ViewParams) {
      if (view === 'flat') {
        const t = upload(input);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.useProgram(flatProg);
        gl.bindVertexArray(vao);
        bindTex(0, t.weave, uf('uWeave'));
        bindTex(1, t.warpColor, uf('uWarpColor'));
        bindTex(2, t.weftColor, uf('uWeftColor'));
        commonUniforms(uf, t, input, v);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        return;
      }
      const ppm = v.pxPerCm / 10;
      const offsetMm: [number, number] = [v.offsetCm[0] * 10, v.offsetCm[1] * 10];
      if (view === 'lit') {
        const t = upload(input);
        const b = ensureBake(t, input, v);
        if ((v.distance ?? 'loupe') !== 'loupe' && b.color) {
          // Göz / Uzak: fiziksel ölçek + ön filtre (viewDistance.ts)
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.viewport(0, 0, canvas.width, canvas.height);
          gl.useProgram(viewProg);
          gl.bindVertexArray(vao);
          bindTex(0, b.color, uv('uColorTile'));
          gl.uniform2f(uv('uTileMm'), b.tile.mm[0], b.tile.mm[1]);
          gl.uniform2f(uv('uOffsetMm'), offsetMm[0], offsetMm[1]);
          gl.uniform2f(uv('uPxPerMmXY'), ppm, ppm);
          gl.uniform1f(uv('uSigmaMm'), viewBlurMm(v.distance as 'eye' | 'far', input));
          gl.uniform1f(uv('uTexPerMm'), b.density);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          return;
        }
        if (profile === 'mobile' && b.color) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.viewport(0, 0, canvas.width, canvas.height);
          gl.useProgram(tileProg);
          gl.bindVertexArray(vao);
          bindTex(0, b.color, ut('uColorTile'));
          gl.uniform2f(ut('uTileMm'), b.tile.mm[0], b.tile.mm[1]);
          gl.uniform2f(ut('uOffsetMm'), offsetMm[0], offsetMm[1]);
          gl.uniform2f(ut('uPxPerMmXY'), ppm, ppm);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          return;
        }
        const hairTex = v.quality === 'high' ? ensureHair(t, input, v) : null;
        const { g } = renderScreenGBuffer(input, v);
        drawLit(t, input, v, g, b, hairTex, null, [ppm, ppm], offsetMm);
        return;
      }
      const { t, g } = renderScreenGBuffer(input, v);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(prevProg);
      gl.bindVertexArray(vao);
      bindTex(0, g.gb0, up('uGb0'));
      bindTex(1, g.gb1, up('uGb1'));
      bindTex(2, t.warpColor, up('uWarpColor'));
      bindTex(3, t.weftColor, up('uWeftColor'));
      gl.uniform1i(up('uWarpCount'), t.packed.counts.warp);
      gl.uniform1i(up('uWeftCount'), t.packed.counts.weft);
      gl.uniform3fv(up('uLightDir'), lightDirection(v.light.azimuthDeg, v.light.elevationDeg));
      gl.uniform1f(up('uBgHeight'), t.bgHeight);
      gl.uniform1f(up('uHeightRange'), t.heightRange);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    readPixels() {
      const out = new Uint8Array(canvas.width * canvas.height * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, out);
      return out;
    },
    readGBuffer() {
      if (!gbuf) throw new Error('Önce G-buffer üreten bir render gerekli.');
      if (!gbuf.float) throw new Error('G-buffer okuma yalnız RGBA32F hedefle destekleniyor.');
      const n = gbuf.width * gbuf.height * 4;
      const gb0 = new Float32Array(n);
      const gb1 = new Float32Array(n);
      gl.bindFramebuffer(gl.FRAMEBUFFER, gbuf.fbo);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      gl.readPixels(0, 0, gbuf.width, gbuf.height, gl.RGBA, gl.FLOAT, gb0);
      gl.readBuffer(gl.COLOR_ATTACHMENT1);
      gl.readPixels(0, 0, gbuf.width, gbuf.height, gl.RGBA, gl.FLOAT, gb1);
      const gb3 = new Float32Array(n);
      gl.readBuffer(gl.COLOR_ATTACHMENT3);
      gl.readPixels(0, 0, gbuf.width, gbuf.height, gl.RGBA, gl.FLOAT, gb3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { width: gbuf.width, height: gbuf.height, gb0, gb1, gb3 };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if ('removeEventListener' in canvas) canvas.removeEventListener('webglcontextlost', onLost as EventListener);
      if (pendingQuery) gl.deleteQuery(pendingQuery);
      freeTextures();
      if (gbuf) freeGB(gbuf);
      gbuf = null;
      freeBake();
      freeHair();
      for (const p of [flatProg, gbProg, prevProg, occProg, litProg, tileProg, viewProg]) gl.deleteProgram(p);
      gl.deleteVertexArray(vao);
      gl.deleteTexture(fiberTex);
      gl.deleteTexture(emptyTex);
    },
  };

  return {
    render(input: FabricInput, v: ViewParams) {
      if (disposed) throw new Error('Renderer kapatıldı.');
      if (contextLost || gl.isContextLost()) {
        contextLost = true;
        return;
      }
      lastBakeMs = null;
      if (method === 'timer' && timerExt) {
        pollQuery();
        let q: WebGLQuery | null = null;
        if (!pendingQuery) {
          q = gl.createQuery();
          if (q) gl.beginQuery(timerExt.TIME_ELAPSED_EXT, q);
        }
        api.draw(input, v);
        if (q) {
          gl.endQuery(timerExt.TIME_ELAPSED_EXT);
          pendingQuery = q;
        }
      } else if (method === 'sync') {
        const t0 = performance.now();
        api.draw(input, v);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, syncPixel);
        gpuMs = performance.now() - t0;
      } else {
        api.draw(input, v);
      }
    },
    stats(): RenderStats {
      if (!contextLost && !disposed) pollQuery();
      return {
        gpuMs,
        method,
        contextLost,
        bakeMs: lastBakeMs,
        tile: bake ? { mm: bake.tile.mm, texels: bake.size, ms: bake.ms, hairStrokes: hair?.strokes ?? 0, hairMs: hair?.ms ?? 0 } : null,
      };
    },
    readPixels: api.readPixels,
    readGBuffer: api.readGBuffer,
    dispose: api.dispose,
  };
}
