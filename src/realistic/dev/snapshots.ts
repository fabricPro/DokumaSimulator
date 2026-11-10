/**
 * Gerçekçi mod snapshot sayfası (yalnız geliştirme). URL: /dev/realistic-snapshots?phase=N
 * Tüm örnekleri sabit adlarla render eder, dev sunucusuna kaydettirir (samples/realistic/phaseN/),
 * bitince window.__snapshotsDone = true ve window.__snapshotsReport = rapor.
 * İleride bir Playwright scripti yalnız bu sayfayı açıp __snapshotsDone'ı bekleyebilir.
 */
import { createRealisticRenderer, flatColorAt, geometryAt, geometryParamsFromInput, hexToRgba, isRealisticSupported, photoRect, simView } from '../index';
import type { CalibView } from '../calibration';
import { simulatePhysical } from '../../render-engine/physical/simulate';
import { constantPhysicalRandom } from '../../render-engine/physical/random';
import type { FabricSpec } from '../../render-engine/types';
import { expandBandedFixture, inputFromRows, type BandedFixture } from '../fixtures';
import type { FabricInput, ViewParams } from '../types';
import { brokenTwill13, plain, satin5, twill22, twill31 } from '../../presets/weaves';
import banded from '../../../fixtures/banded-warp-sample.json';
import acikSpecJson from '../../../samples/input/acik-coklu-atki.json';
import { fabricInputFromSpec } from '../adapters/fromSpec';
import { computeMetrics } from '../../render-engine/physical/metrics';
import { DEMO_DESENLER } from '../../app/demoDesenler';
import { atkiJsonToFabricSpec, orguAnahtari } from '../../adapters/atkiJson';
import { cssPxPerMm, viewBlurMm, resolvableMm, VIEW_DISTANCE_MM } from '../viewDistance';
import { physicalExample } from '../../presets/physicalExample';
import { diameterMm as yarnDiameterMm, toTex as yarnToTex } from '../yarn';

declare global {
  interface Window {
    __snapshotsDone?: boolean;
    __snapshotsReport?: unknown;
  }
}

const SIZE = 1024;
const LIGHT = { azimuthDeg: 135, elevationDeg: 45 };

interface Sample {
  file: string;
  title: string;
  input: FabricInput;
  pxPerCm: number;
  tuning?: ViewParams['tuning'];
}

const W = '#e8e2d0';
const F = '#3f4f6b';
const bandedInput = expandBandedFixture(banded as BandedFixture);
const SAMPLES: Sample[] = [
  { file: 'plain.png', title: 'Bez ayağı', input: inputFromRows(plain(), W, F), pxPerCm: 500 },
  { file: 'twill-2-2.png', title: '2/2 dimi', input: inputFromRows(twill22(), W, F), pxPerCm: 500 },
  { file: 'twill-3-1.png', title: '3/1 dimi', input: inputFromRows(twill31(), W, F), pxPerCm: 500 },
  { file: 'satin-5.png', title: "5'li saten", input: inputFromRows(satin5(), W, F), pxPerCm: 500 },
  { file: 'broken-twill-1-3.png', title: '1/3 kırık dimi', input: inputFromRows(brokenTwill13(), W, F), pxPerCm: 500 },
  // Bantlı çözgü: tüm rapor (251 tel ≈ 6.3 cm) ve yakın plan
  { file: 'banded-warp.png', title: 'Bantlı çözgü (tam rapor)', input: bandedInput, pxPerCm: 160 },
  { file: 'banded-warp-detail.png', title: 'Bantlı çözgü (yakın plan)', input: bandedInput, pxPerCm: 500 },
  {
    file: 'irregularity-strong.png',
    title: 'Düzensizlik ×3 (kalınlık %12, konum %15, ΔE 4.5) — bez ayağı',
    input: inputFromRows(plain(), W, F),
    pxPerCm: 500,
    tuning: { irregularity: 3 },
  },
  { file: 'luster-compare.png', title: 'Parlaklık: sol mat pamuk, sağ parlak polyester (aynı renk ve numara)', input: lusterInput(), pxPerCm: 500 },
];

/** Aynı renk ve numarada iki çözgü bandı: 40 tel mat pamuk + 40 tel parlak polyester, 2/2 dimi, koyu atkı. */
function lusterInput(): FabricInput {
  const base = inputFromRows(twill22(), '#d9cdb0', '#2f3a4f');
  const warp = Array.from({ length: 80 }, (_, k) => ({ color: '#d9cdb0', yarnType: k < 40 ? 0 : 2 }));
  return {
    ...base,
    warp,
    yarnTypes: [
      { count: 295, unit: 'Dtex', twist: 'Z', twistPerM: 700, luster: 'mat', hairiness: 0.35 },
      { count: 295, unit: 'Dtex', twist: 'S', twistPerM: 300, luster: 'mat', hairiness: 0.3 },
      { count: 295, unit: 'Dtex', twist: 'Z', twistPerM: 300, luster: 'parlak', hairiness: 0.03 },
    ],
  };
}

/** Kayıt klasörü etiketi: sayısal faz ya da düzeltme turu adı ('fix-v2' → samples/realistic/fix-v2/). */
let SAVE_TAG: number | string = 1;
const folderOf = (tag: number | string) => (typeof tag === 'number' ? `phase${tag}` : tag);

async function save(_phase: number, name: string, body: string, kind: 'png' | 'json') {
  const res = await fetch('/__realistic/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phase: SAVE_TAG, name, kind, data: body }),
  });
  if (!res.ok) throw new Error(`${name} kaydedilemedi: ${res.status} ${await res.text()}`);
}

/** Faz 1 doğrulaması: GPU çıktısı ile CPU ikizinin (flatColorAt) piksel eşleşmesi. */
function compareFlat(gpu: Uint8Array, input: FabricInput, view: ViewParams): { matchPct: number; mismatches: number } {
  const cache = new Map<string, [number, number, number, number]>();
  let bad = 0;
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      const hex = flatColorAt(px, py, input, view);
      let c = cache.get(hex);
      if (!c) cache.set(hex, (c = hexToRgba(hex)));
      const o = (py * SIZE + px) * 4; // readPixels: satır 0 = alt (GL), ikiz de py alttan
      if (gpu[o] !== c[0] || gpu[o + 1] !== c[1] || gpu[o + 2] !== c[2]) bad++;
    }
  }
  return { matchPct: (100 * (SIZE * SIZE - bad)) / (SIZE * SIZE), mismatches: bad };
}

/** Karşılaştırma için tek iplikli FabricSpec (mevcut CPU heightfield girdisi; renkler önemsiz). */
function specForCompare(inp: FabricInput): FabricSpec {
  const weave: boolean[][] = [];
  for (let r = 0; r < inp.weave.wefts; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < inp.weave.warps; c++) row.push(inp.weave.data[r * inp.weave.warps + c] === 1);
    weave.push(row);
  }
  const slot = (k: number) => {
    const y = inp.yarnTypes[k];
    return { name: 'A' as const, count: y.count, system: y.unit, color: '#888888', twist: y.twist };
  };
  return {
    version: 2,
    weave,
    warpSlots: [slot(inp.warp[0].yarnType)],
    weftSlots: [slot(inp.weft[0].yarnType)],
    warpSequence: [0],
    weftSequence: [0],
    warpDensityLoom: inp.density.warpPerCm,
    weftDensityLoom: inp.density.weftPerCm,
    warpShrinkPct: 0,
    weftShrinkPct: 0,
    warpCrimpShare: inp.crimpShare ?? 0.4,
  };
}

/**
 * Faz 2 tutarlılığı (gürültüsüz, k = 1): GPU G-buffer ↔ (a) CPU ikizi geometryAt, (b) mevcut CPU
 * heightfield (simulatePhysical, geometryOnly). CPU iplik g'nin merkezi (g − 0.5)·p, gerçekçi modda
 * i'nin (i + 0.5)·p olduğundan GPU penceresi bir aralık kaydırılır. Eşik: kimlik ≥ %99.5,
 * yükseklik farkı (eşleşen piksellerde, %99.9 dilim) ≤ 0.02·r.
 */
function consistency(s: Sample): Record<string, unknown> {
  const inp = s.input;
  const g = geometryParamsFromInput(inp, 0, 0);
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const r = createRealisticRenderer(canvas, { preserveDrawingBuffer: true });
  const shift: [number, number] = [g.pitchWarp / 10, g.pitchWeft / 10];
  r.render(inp, { pxPerCm: s.pxPerCm, offsetCm: shift, light: LIGHT, quality: 'high', tuning: { flattening: 0, irregularity: 0, model: 'classic' } });
  const gb = r.readGBuffer();
  r.dispose();
  const ppm = s.pxPerCm / 10;
  const cpu = simulatePhysical(
    specForCompare(inp),
    { x0Mm: 0, y0Mm: 0, widthMm: SIZE / ppm, heightMm: SIZE / ppm, pxPerMm: ppm },
    { random: constantPhysicalRandom(), scaleBar: false, debug: { geometryOnly: true, collect: true } },
  ).debug!;
  const rMin = Math.min(g.warpRadius(0), g.weftRadius(0));
  let idTwin = 0;
  let idCpu = 0;
  const dhTwin: number[] = [];
  const dhCpu: number[] = [];
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      const o = (py * SIZE + px) * 4;
      const gpuH = gb.gb0[o];
      const gpuAxis = Math.round(gb.gb1[o + 2]); // 0 zemin, 1 çözgü, 2 atkı
      const gpuIdx = Math.round(gb.gb0[o + 3]);
      // CPU heightfield'ın eski kimlik kodlaması (bu bölge orijinin sağ üstünde, indeksler ≥ 0)
      const gpuId = gpuAxis === 1 ? gpuIdx + 1 : gpuAxis === 2 ? -(gpuIdx + 1) : 0;
      const X = shift[0] * 10 + Math.fround(px / Math.fround(ppm));
      const Y = shift[1] * 10 + Math.fround(py / Math.fround(ppm));
      const t = geometryAt(X, Y, g);
      if (t.axis === gpuAxis && (gpuAxis === 0 || t.index === gpuIdx)) {
        idTwin++;
        if (gpuId !== 0) dhTwin.push(Math.abs(t.height - gpuH));
      }
      const co = (SIZE - 1 - py) * SIZE + px; // CPU satırı üstten
      if (cpu.topId[co] === gpuId) {
        idCpu++;
        if (gpuId !== 0) dhCpu.push(Math.abs(cpu.height[co] - gpuH));
      }
    }
  }
  const p999 = (a: number[]) => {
    if (a.length === 0) return 0;
    const sorted = Float64Array.from(a).sort();
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.999))];
  };
  const total = SIZE * SIZE;
  const res = {
    file: s.file,
    idMatchTwinPct: +((100 * idTwin) / total).toFixed(3),
    idMatchCpuPct: +((100 * idCpu) / total).toFixed(3),
    dhTwinP999OverR: +(p999(dhTwin) / rMin).toFixed(5),
    dhCpuP999OverR: +(p999(dhCpu) / rMin).toFixed(5),
    dhCpuMaxOverR: +(dhCpu.reduce((m, v) => Math.max(m, v), 0) / rMin).toFixed(5),
  };
  return {
    ...res,
    pass: res.idMatchTwinPct >= 99.5 && res.idMatchCpuPct >= 99.5 && res.dhTwinP999OverR <= 0.02 && res.dhCpuP999OverR <= 0.02,
  };
}

/**
 * Faz 4 determinizmi: aynı girdi + tohum, ayrı bir renderer örneğinde yeniden render edilir → birebir
 * aynı pikseller beklenir. Tohum + 1 ile render farklı olmalı (düzensizlik gerçekten tohuma bağlı).
 */
function determinism(s: Sample, view: ViewParams, first: Uint8Array): Record<string, unknown> {
  const again = (input: FabricInput) => {
    const c = document.createElement('canvas');
    c.width = SIZE;
    c.height = SIZE;
    const r = createRealisticRenderer(c, { preserveDrawingBuffer: true });
    r.render(input, view);
    const px = r.readPixels();
    r.dispose();
    return px;
  };
  const same = again({ ...s.input });
  let identical = same.length === first.length;
  for (let k = 0; identical && k < first.length; k++) if (same[k] !== first[k]) identical = false;
  const other = again({ ...s.input, seed: (s.input.seed ?? 1) + 1 });
  let diff = 0;
  for (let k = 0; k < first.length; k += 4) {
    if (other[k] !== first[k] || other[k + 1] !== first[k + 1] || other[k + 2] !== first[k + 2]) diff++;
  }
  const otherSeedDiffPct = +((100 * diff) / (first.length / 4)).toFixed(2);
  return { identical, otherSeedDiffPct, pass: identical && otherSeedDiffPct > 1 };
}

/**
 * Faz 5 kalibrasyon: kalibrasyon görünümünün kullandığı ortak-ölçek yardımcılarıyla (photoRect / simView)
 *  (a) hizalama kontrolü: Faz 4 '2/2 dimi' snapshot'ı (500 px/cm) "fotoğraf" olarak alınır; aynı girdi, ışık
 *      ve tohumla simView üzerinden render edilen kare fotoğrafla piksel piksel aynı olmalı
 *      (ölçek, y yönü ve kaydırma uçtan uca doğru).
 *  (b) görsel kompozitler: yan yana ve perde (%50) — fotoğraf yerine geçen snapshot (tohum 1) ile farklı
 *      tohum ve ışıktaki simülasyon, ekranda 700 px/cm'de (fotoğraf yeniden ölçeklenir).
 * Gerçek numune fotoğrafı depoda yok; kullanıcı kendi fotoğrafıyla uygulamadaki Kalibrasyon görünümünü kullanır.
 */
async function calibration(phase: number, say: (t: string) => void) {
  // Bu çalıştırmada az önce kaydedilen 2/2 dimi (ölçek / y yönü / kaydırma uçtan uca)
  const src = `/samples/realistic/${folderOf(SAVE_TAG)}/twill-2-2.png?t=${Date.now()}`;
  const img = await new Promise<HTMLImageElement>((ok, fail) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = () => fail(new Error(src + ' yüklenemedi'));
    i.src = src;
  });
  const photoPxPerCm = 500;
  const input = SAMPLES[1].input;
  const base = { light: LIGHT, quality: 'high' as const };

  // (a) hizalama: ekran 500 px/cm, fotoğraf 1:1; snapshot'ın alt kenarı kumaşta y = 0 olduğundan
  // simülasyon y'de fotoğraf yüksekliği kadar kaydırılır.
  const H = img.naturalHeight;
  const v0: CalibView = { screenPxPerCm: photoPxPerCm, x0Cm: 0, y0Cm: 0, simShiftCm: [0, H / photoPxPerCm] };
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = H;
  const r = createRealisticRenderer(c, { preserveDrawingBuffer: true });
  r.render(input, simView(v0, H, 1, base));
  const sim = document.createElement('canvas');
  sim.width = c.width;
  sim.height = c.height;
  const sctx = sim.getContext('2d')!;
  sctx.drawImage(c, 0, 0);
  const ref = document.createElement('canvas');
  ref.width = c.width;
  ref.height = c.height;
  const rctx = ref.getContext('2d')!;
  rctx.drawImage(img, 0, 0);
  const a = sctx.getImageData(0, 0, c.width, c.height).data;
  const b = rctx.getImageData(0, 0, c.width, c.height).data;
  let same = 0;
  let maxDiff = 0;
  for (let k = 0; k < a.length; k += 4) {
    const d = Math.max(Math.abs(a[k] - b[k]), Math.abs(a[k + 1] - b[k + 1]), Math.abs(a[k + 2] - b[k + 2]));
    if (d === 0) same++;
    maxDiff = Math.max(maxDiff, d);
  }
  const identicalPct = +((100 * same) / (a.length / 4)).toFixed(3);
  const alignment = { photo: src, photoPxPerCm, identicalPct, maxChannelDiff: maxDiff, pass: identicalPct >= 99.9 };
  say('Kalibrasyon hizalaması: ' + JSON.stringify(alignment));

  // (a2) orijin kontrolü: kalibrasyonda görünüm kumaşın negatif bölgesine kayar. Düzensizlik kapalıyken
  // [0,0] ve dört rapor solda / altta aynı geometri çıkmalı: G-buffer'da sistem aynı, indeks 4 rapor farklı,
  // yükseklik aynı; ayrıca her sistemin ortalama rengi aynı (eski +(i+1)/−(j+1) kimliği burada atkıyı
  // kaybediyordu). Piksel eşitliği beklenmez: lif gürültüsü iplik boyunca mutlak konuma (mm mod 16) bağlı.
  const origin: Record<string, unknown>[] = [];
  for (const smp of SAMPLES.slice(0, 5)) {
    const inp = smp.input;
    const nx = inp.weave.warps;
    const ny = inp.weave.wefts;
    const rx = (4 * nx) / inp.density.warpPerCm; // cm
    const ry = (4 * ny) / inp.density.weftPerCm;
    const cv = document.createElement('canvas');
    cv.width = 256;
    cv.height = 256;
    const rr = createRealisticRenderer(cv, { preserveDrawingBuffer: true });
    // rölyef kapalı: lif dokusu mutlak konuma bağlı, rapor periyodik değil (geometri burada sınanır)
    const vw = (o: [number, number]): ViewParams => ({ pxPerCm: 500, offsetCm: o, light: LIGHT, quality: 'high', tuning: { irregularity: 0, relief: 0 } });
    const grab = (o: [number, number]) => {
      rr.render(inp, vw(o));
      const px = rr.readPixels();
      const gb = rr.readGBuffer();
      const mean = [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ];
      for (let k = 0; k < px.length; k += 4) {
        const ax = Math.round(gb.gb1[k + 2]);
        if (ax === 0) continue;
        const m = mean[ax - 1];
        m[0] += px[k];
        m[1] += px[k + 1];
        m[2] += px[k + 2];
        m[3]++;
      }
      return { gb, mean: mean.map((m) => (m[3] ? [m[0] / m[3], m[1] / m[3], m[2] / m[3]] : [0, 0, 0])) };
    };
    const A = grab([0, 0]);
    const B = grab([-rx, -ry]);
    rr.dispose();
    let same = 0;
    let n = 0;
    let maxDh = 0;
    for (let k = 0; k < A.gb.gb0.length; k += 4) {
      n++;
      const axA = Math.round(A.gb.gb1[k + 2]);
      const axB = Math.round(B.gb.gb1[k + 2]);
      const iA = Math.round(A.gb.gb0[k + 3]);
      const iB = Math.round(B.gb.gb0[k + 3]);
      const ok = axA === axB && (axA === 0 || iB + 4 * (axA === 1 ? nx : ny) === iA);
      if (ok) same++;
      maxDh = Math.max(maxDh, Math.abs(A.gb.gb0[k] - B.gb.gb0[k]));
    }
    const meanDiff = Math.max(...A.mean.flatMap((m, a) => m.map((c, q) => Math.abs(c - B.mean[a][q]))));
    const pct = +((100 * same) / n).toFixed(3);
    origin.push({
      file: smp.file,
      offsetCm: [+(-rx).toFixed(4), +(-ry).toFixed(4)],
      axisIndexMatchPct: pct,
      maxDhMm: +maxDh.toExponential(2),
      meanColorDiff: +meanDiff.toFixed(2),
      pass: pct >= 99.5 && meanDiff <= 3,
    });
  }
  say('Orijin (negatif bölge): ' + JSON.stringify(origin));

  // (b) kompozitler
  const PW = 512;
  const PH = 768;
  const S = 700;
  const v: CalibView = { screenPxPerCm: S, x0Cm: 0.05, y0Cm: 0.1, simShiftCm: [0, 0] };
  const simInput = { ...input, seed: 7 };
  const simBase = { light: { azimuthDeg: 200, elevationDeg: 35 }, quality: 'high' as const };
  const renderPane = (w: number) => {
    c.width = w;
    c.height = PH;
    r.render(simInput, simView(v, PH, 1, simBase));
    return c;
  };
  const drawPhoto = (ctx: CanvasRenderingContext2D, x: number, w: number) => {
    const pr = photoRect(v, { width: img.naturalWidth, height: img.naturalHeight, pxPerCm: photoPxPerCm });
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, 0, w, PH);
    ctx.clip();
    ctx.fillStyle = '#000';
    ctx.fillRect(x, 0, w, PH);
    ctx.drawImage(img, x + pr.left, pr.top, pr.width, pr.height);
    ctx.restore();
  };
  const label = (ctx: CanvasRenderingContext2D, x: number, t: string) => {
    ctx.font = '14px system-ui, sans-serif';
    const w = ctx.measureText(t).width + 16;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(x, 8, w, 22);
    ctx.fillStyle = '#fff';
    ctx.fillText(t, x + 8, 24);
  };
  const bar = (ctx: CanvasRenderingContext2D, x: number) => {
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(x + 8, PH - 34, S / 10 + 60, 26);
    ctx.fillStyle = '#fff';
    ctx.fillRect(x + 16, PH - 23, S / 10, 4);
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText('1 mm', x + 24 + S / 10, PH - 16);
  };
  // yan yana
  const out = document.createElement('canvas');
  out.width = PW * 2 + 4;
  out.height = PH;
  const o = out.getContext('2d')!;
  o.fillStyle = '#000';
  o.fillRect(0, 0, out.width, PH);
  drawPhoto(o, 0, PW);
  o.drawImage(renderPane(PW), PW + 4, 0);
  label(o, 8, 'Fotoğraf (500 px/cm, yerine geçen)');
  label(o, PW + 12, 'Simülasyon (tohum 7, ışık 200°/35°)');
  bar(o, 0);
  bar(o, PW + 4);
  await save(phase, 'calibration-side.png', out.toDataURL('image/png'), 'png');
  // perde
  const out2 = document.createElement('canvas');
  out2.width = PW * 2;
  out2.height = PH;
  const o2 = out2.getContext('2d')!;
  drawPhoto(o2, 0, PW * 2);
  const full = renderPane(PW * 2);
  o2.drawImage(full, PW, 0, PW, PH, PW, 0, PW, PH);
  o2.fillStyle = '#fff';
  o2.fillRect(PW - 1, 0, 2, PH);
  label(o2, 8, 'Fotoğraf');
  label(o2, PW * 2 - 110, 'Simülasyon');
  bar(o2, 0);
  await save(phase, 'calibration-curtain.png', out2.toDataURL('image/png'), 'png');
  r.dispose();
  await save(phase, 'calibration.json', JSON.stringify({ alignment, origin, composites: { screenPxPerCm: S, pane: [PW, PH] } }, null, 2), 'json');
  return { alignment, origin, originPass: origin.every((o) => o.pass) };
}

/**
 * Faz 6 performans: 1024² pencere, her kalite seviyesi ve her örnek için kare süresi.
 * EXT_disjoint_timer_query_webgl2 varsa gerçek GPU süresi; yoksa render + 1 piksel okuma (kaba).
 * 3 ısınma + 10 ölçüm karesi, medyan ve en kötü. Hedef: orta telefonda < 16 ms (telefonda ölçülecek).
 */
async function perf(phase: number, say: (t: string) => void) {
  // Gizli sayfada requestAnimationFrame çalışmaz: 'sync' ölçüme (render + 1 piksel okuma) düşülür.
  const hidden = typeof document !== 'undefined' && document.hidden;
  // Panel gizliyken document.hidden false olsa da rAF durabilir: rAF ya da 40 ms, hangisi önce gelirse
  const frame = () =>
    hidden
      ? Promise.resolve()
      : new Promise<void>((ok) => {
          let done = false;
          const fin = () => {
            if (!done) {
              done = true;
              ok();
            }
          };
          requestAnimationFrame(fin);
          setTimeout(fin, 40);
        });
  const run1 = async (profile: 'desktop' | 'mobile') => {
    const c = document.createElement('canvas');
    c.width = SIZE;
    c.height = SIZE;
    const r = createRealisticRenderer(c, { measure: hidden ? 'sync' : 'auto', profile });
    const gl = c.getContext('webgl2') as WebGL2RenderingContext;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    const rows: Record<string, unknown>[] = [];
    const picks = [SAMPLES[0], SAMPLES[1], SAMPLES[3], SAMPLES.find((x) => x.file === 'banded-warp-detail.png')!];
    for (const q of ['low', 'medium', 'high'] as const) {
      for (const smp of picks) {
        const times: number[] = [];
        let bakeMs: number | null = null;
        let tile: unknown = null;
        for (let k = 0; k < 13; k++) {
          // gezinme: her karede görünüm kayar ve yakınlaşır (döşeme önbellekten okunur)
          r.render(smp.input, { pxPerCm: smp.pxPerCm * (1 + 0.02 * k), offsetCm: [k * 0.013, k * 0.007], light: LIGHT, quality: q });
          const st0 = r.stats();
          if (k === 0) {
            bakeMs = st0.bakeMs ?? null;
            tile = st0.tile;
          }
          await frame();
          await frame();
          const st = r.stats();
          if (k >= 3 && st.gpuMs !== null) times.push(st.gpuMs);
        }
        times.sort((a, b) => a - b);
        rows.push({
          profile,
          quality: q,
          file: smp.file,
          method: r.stats().method,
          frameMedianMs: +(times[Math.floor(times.length / 2)] ?? NaN).toFixed(2),
          frameWorstMs: +(times[times.length - 1] ?? NaN).toFixed(2),
          bakeMs: bakeMs === null ? null : +bakeMs.toFixed(1),
          tile,
        });
      }
    }
    r.dispose();
    return { gpu, rows };
  };
  const d = await run1('desktop');
  const m = await run1('mobile');
  const summary = {
    gpu: d.gpu,
    size: SIZE,
    budgetMs: { navigation: 4, frame: 16 },
    note: 'frame* = gezinme karesi (döşeme önbellekten); bakeMs = desen / ışık / kalite değişince bir kez (CPU duvar saati, tüy CPU üretimi dahil)',
    rows: [...d.rows, ...m.rows],
  };
  await save(phase, 'perf.json', JSON.stringify(summary, null, 2), 'json');
  say('Performans: ' + JSON.stringify(summary).slice(0, 4000));
  return summary;
}

/**
 * fix-v2 karşılaştırmaları (reference/realistic-v2). Prototip parametreleri görüntü boyutundan:
 *  yakın plan OFF = 100, 56 tel, PW = 32 px (128 px/mm), 1792×820; genel 251 tel, PW = 13 (52 px/mm), 3263×560.
 *  Prototip satırı j (aşağı) = bizim −r → görüntünün üst kenarı kumaşta y = 1 atkı aralığı.
 *  Işık L = (−0.50, −0.62, 0.60) (görüntüde y aşağı) → azimut ≈ 128.9°, yükseklik ≈ 37.0°.
 */
const PROTO_LIGHT = (() => {
  const L = [-0.5, 0.62, 0.6]; // y yukarı
  const n = Math.hypot(L[0], L[1], L[2]);
  return { azimuthDeg: (Math.atan2(L[1], L[0]) * 180) / Math.PI, elevationDeg: (Math.asin(L[2] / n) * 180) / Math.PI };
})();

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, fail) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = () => fail(new Error(src + ' yüklenemedi'));
    i.src = src;
  });
}

function renderBanded(w: number, h: number, ppmMm: number, offEnds: number, tuning?: ViewParams['tuning']): HTMLCanvasElement {
  const inp = bandedInput;
  const pw = 10 / inp.density.warpPerCm; // mm
  const pf = 10 / inp.density.weftPerCm;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const r = createRealisticRenderer(c, { preserveDrawingBuffer: true });
  r.render(inp, {
    pxPerCm: ppmMm * 10,
    offsetCm: [(offEnds * pw) / 10, (pf - h / ppmMm) / 10],
    light: PROTO_LIGHT,
    quality: 'high',
    ...(tuning ? { tuning } : {}),
  });
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d')!.drawImage(c, 0, 0);
  r.dispose();
  return out;
}

function labelOn(ctx: CanvasRenderingContext2D, x: number, y: number, t: string) {
  ctx.font = '16px system-ui, sans-serif';
  const w = ctx.measureText(t).width + 16;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(x, y, w, 24);
  ctx.fillStyle = '#fff';
  ctx.fillText(t, x + 8, y + 17);
}

/** Bantlı fixture → eski CPU heightfield için FabricSpec (4 slot: krem, kahve, hardal, taba; bej → krem). */
function bandedSpec(): FabricSpec {
  const f = banded as BandedFixture;
  const palette = ['#E3DCC8', '#4E3A1E', '#CDAE66', '#A99A78'];
  const slotOf = (c: string) => Math.max(0, palette.indexOf(c.toUpperCase()));
  const seq: number[] = [];
  for (const b of f.warpBands) for (let k = 0; k < b.ends; k++) seq.push(slotOf(b.color));
  const inp = bandedInput;
  const weave: boolean[][] = [];
  for (let r = 0; r < inp.weave.wefts; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < inp.weave.warps; c++) row.push(inp.weave.data[r * inp.weave.warps + c] === 1);
    weave.push(row);
  }
  const names = ['A', 'B', 'C', 'D'] as const;
  return {
    version: 2,
    weave,
    warpSlots: palette.map((color, k) => ({ name: names[k], count: f.yarn.count, system: f.yarn.unit, color, twist: f.yarn.twist })),
    weftSlots: [{ name: 'A', count: f.yarn.count, system: f.yarn.unit, color: f.weft.color, twist: f.yarn.twist }],
    warpSequence: seq,
    weftSequence: [0],
    warpDensityLoom: inp.density.warpPerCm,
    weftDensityLoom: inp.density.weftPerCm,
    warpShrinkPct: 0,
    weftShrinkPct: 0,
    warpCrimpShare: 0.4,
  } as FabricSpec;
}

async function fixV2(phase: number, say: (t: string) => void) {
  const out: Record<string, unknown> = { light: PROTO_LIGHT };
  // 1) Yakın plan
  {
    const W = 1792;
    const H = 820;
    const target = await loadImage('/reference/realistic-v2/hedef_yakin_plan_v2.jpg');
    const ours = renderBanded(W, H, 128, 100);
    const c = document.createElement('canvas');
    c.width = 2 * W + 8;
    c.height = H;
    const g = c.getContext('2d')!;
    g.fillStyle = '#000';
    g.fillRect(0, 0, c.width, H);
    g.drawImage(target, 0, 0, W, H);
    g.drawImage(ours, W + 8, 0);
    labelOn(g, 10, 10, 'Hedef (prototip v2)');
    labelOn(g, W + 18, 10, 'Gerçekçi mod (fix-v2) — aynı desen, 128 px/mm, ışık 129°/37°');
    await save(phase, 'compare_yakin.png', c.toDataURL('image/png'), 'png');
    await save(phase, 'yakin_yeni.png', ours.toDataURL('image/png'), 'png');
    out.yakin = { size: [W, H], pxPerMm: 128, offEnds: 100 };
  }
  // 2) Genel görünüm (tam rapor)
  {
    const W = 3263;
    const H = 560;
    const target = await loadImage('/reference/realistic-v2/hedef_genel_gorunum_v2.png');
    const ours = renderBanded(W, H, 52, 0);
    const c = document.createElement('canvas');
    c.width = W;
    c.height = 2 * H + 8;
    const g = c.getContext('2d')!;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, c.height);
    g.drawImage(target, 0, 0, W, H);
    g.drawImage(ours, 0, H + 8);
    labelOn(g, 10, 10, 'Hedef (prototip v2), tam rapor 251 tel');
    labelOn(g, 10, H + 18, 'Gerçekçi mod (fix-v2), 52 px/mm');
    await save(phase, 'compare_genel.png', c.toDataURL('image/png'), 'png');
    out.genel = { size: [W, H], pxPerMm: 52 };
  }
  // 3) Eski CPU heightfield ↔ yeni gerçekçi (aynı desen, aynı pencere). CPU ipliği g'nin merkezi (g − 0.5)·p,
  //    gerçekçide (i + 0.5)·p → aynı iplikler için CPU penceresi bir aralık geride.
  {
    const W = 896;
    const H = 820;
    const ppm = 128;
    const inp = bandedInput;
    const pw = 10 / inp.density.warpPerCm;
    const pf = 10 / inp.density.weftPerCm;
    const x0 = 100 * pw;
    const y0 = pf - H / ppm;
    const t0 = performance.now();
    const cpu = simulatePhysical(bandedSpec(), { x0Mm: x0 - pw, y0Mm: y0 - pf, widthMm: W / ppm, heightMm: H / ppm, pxPerMm: ppm }, { scaleBar: false });
    const cpuMs = performance.now() - t0;
    const oldC = document.createElement('canvas');
    oldC.width = cpu.image.width;
    oldC.height = cpu.image.height;
    oldC.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(cpu.image.data), cpu.image.width, cpu.image.height), 0, 0);
    const ours = renderBanded(W, H, ppm, 100);
    const c = document.createElement('canvas');
    c.width = 2 * W + 8;
    c.height = H;
    const g = c.getContext('2d')!;
    g.fillStyle = '#000';
    g.fillRect(0, 0, c.width, H);
    g.drawImage(oldC, 0, 0);
    g.drawImage(ours, W + 8, 0);
    labelOn(g, 10, 10, 'Eski: CPU heightfield (simulatePhysical)');
    labelOn(g, W + 18, 10, 'Yeni: gerçekçi mod fix-v2');
    await save(phase, 'compare_eski_yeni.png', c.toDataURL('image/png'), 'png');
    out.eskiYeni = { size: [W, H], pxPerMm: ppm, cpuMs: Math.round(cpuMs) };
  }
  // 4) Kalite seviyeleri (yakın plan kırpıntısı)
  {
    const W = 600;
    const H = 400;
    const c = document.createElement('canvas');
    c.width = 3 * W + 16;
    c.height = H;
    const g = c.getContext('2d')!;
    g.fillStyle = '#000';
    g.fillRect(0, 0, c.width, H);
    (['high', 'medium', 'low'] as const).forEach((q, k) => {
      const cv = document.createElement('canvas');
      cv.width = W;
      cv.height = H;
      const r = createRealisticRenderer(cv, { preserveDrawingBuffer: true });
      const pw = 10 / bandedInput.density.warpPerCm;
      r.render(bandedInput, { pxPerCm: 1280, offsetCm: [(128 * pw) / 10, 0], light: PROTO_LIGHT, quality: q });
      g.drawImage(cv, k * (W + 8), 0);
      r.dispose();
      labelOn(g, k * (W + 8) + 10, 10, q === 'high' ? 'yüksek' : q === 'medium' ? 'orta' : 'düşük');
    });
    await save(phase, 'quality_levels.png', c.toDataURL('image/png'), 'png');
  }
  await save(phase, 'fix-v2.json', JSON.stringify(out, null, 2), 'json');
  say('fix-v2: ' + JSON.stringify(out));
  return out;
}

/**
 * fix-v3: açık, çok kalınlıklı atkılı doku (samples/input/acik-coklu-atki.json) ve bantlı çözgü gerilemesi.
 * Kayıtlar samples/realistic/fix-v3/: acik-coklu-atki-{darkgray,black,backlight}.png, banded-warp-detail.png,
 * compare_yakin.png, perf.json (katmanlı / tek katman), fix-v3.json (açıklık karşılaştırması).
 */
const acikSpec = acikSpecJson as unknown as FabricSpec;
const acikInput = fabricInputFromSpec(acikSpec, { luster: 'yarimat', hairiness: 0.25, twistPerM: 600 });

async function fixV3(phase: number, say: (t: string) => void, tag = 'fix-v3') {
  // fix-v4 (yüzey / ışık turu): yalnız acik-coklu-atki yakın zoom + banded-warp-detail + perf
  const v4 = tag === 'fix-v4';
  const out: Record<string, unknown> = { light: LIGHT };
  // 1) Açık doku, üç zemin modu (yakın plan 40 px/mm ≈ 25 px / çözgü aralığı)
  const openness: Record<string, unknown> = {};
  for (const bg of v4 ? (['darkgray'] as const) : (['darkgray', 'black', 'backlight'] as const)) {
    const c = document.createElement('canvas');
    c.width = SIZE;
    c.height = SIZE;
    const r = createRealisticRenderer(c, { preserveDrawingBuffer: true });
    r.render(acikInput, { pxPerCm: v4 ? 1000 : 400, offsetCm: v4 ? [0.3, 0.3] : [0, 0], light: LIGHT, quality: 'high', tuning: { background: bg } });
    await save(phase, v4 ? 'acik-coklu-atki-yakin.png' : `acik-coklu-atki-${bg}.png`, c.toDataURL('image/png'), 'png');
    if (bg === 'darkgray') {
      // Gerçekçi açıklık: 1 − ortalama üst kapsama (kenar yumuşatma dahil; alt katmanın kenar payı yok sayılır)
      const gb = r.readGBuffer();
      let covered = 0;
      for (let k = 0; k < gb.gb1.length; k += 4) if (gb.gb1[k + 2] > 0.5) covered += gb.gb1[k + 3];
      const realisticPct = 100 * (1 - covered / (gb.width * gb.height));
      const metricPct = 100 - computeMetrics(acikSpec).cover;
      Object.assign(openness, { realisticPct: +realisticPct.toFixed(1), metricPct: +metricPct.toFixed(1) });
    }
    r.dispose();
  }
  out.openness = openness;
  say('açıklık: ' + JSON.stringify(openness));
  // 2) Bantlı çözgü yakın plan (fix-v2 ile aynı görünüm)
  {
    const s = SAMPLES.find((x) => x.file === 'banded-warp-detail.png')!;
    const c = document.createElement('canvas');
    c.width = SIZE;
    c.height = SIZE;
    const r = createRealisticRenderer(c, { preserveDrawingBuffer: true });
    r.render(s.input, { pxPerCm: s.pxPerCm, offsetCm: [0, 0], light: LIGHT, quality: 'high' });
    await save(phase, s.file, c.toDataURL('image/png'), 'png');
    r.dispose();
  }
  // 3) Hedefle yakın plan karşılaştırması (fix-v2 compare_yakin ile aynı kurulum)
  if (!v4) {
    const W = 1792;
    const H = 820;
    const target = await loadImage('/reference/realistic-v2/hedef_yakin_plan_v2.jpg');
    const ours = renderBanded(W, H, 128, 100);
    const c = document.createElement('canvas');
    c.width = 2 * W + 8;
    c.height = H;
    const g = c.getContext('2d')!;
    g.fillStyle = '#000';
    g.fillRect(0, 0, c.width, H);
    g.drawImage(target, 0, 0, W, H);
    g.drawImage(ours, W + 8, 0);
    labelOn(g, 10, 10, 'Hedef (prototip v2)');
    labelOn(g, W + 18, 10, 'Gerçekçi mod (fix-v3) — aynı desen, 128 px/mm, ışık 129°/37°');
    await save(phase, 'compare_yakin.png', c.toDataURL('image/png'), 'png');
  }
  // 4) Performans: gezinme karesi, katmanlı ↔ tek katman (masaüstü profil, 1024²). Zamanlayıcı sorgusu panel
  //    gizliyken seyrek / tutarsız döndüğü için duvar saati: render + 1 piksel okuma (GPU'yu bekletir), medyan.
  {
    const picks: Array<{ file: string; input: FabricInput; pxPerCm: number }> = [
      { file: 'acik-coklu-atki', input: acikInput, pxPerCm: 400 },
      { file: 'banded-warp-detail', input: bandedInput, pxPerCm: 500 },
      { file: 'plain', input: SAMPLES[0].input, pxPerCm: 500 },
    ];
    const rows: Record<string, unknown>[] = [];
    let gpu = '';
    for (const layered of [true, false]) {
      const c = document.createElement('canvas');
      c.width = SIZE;
      c.height = SIZE;
      const r = createRealisticRenderer(c, { singleLayer: !layered });
      const gl = c.getContext('webgl2') as WebGL2RenderingContext;
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
      const px = new Uint8Array(4);
      for (const q of ['medium', 'high'] as const) {
        for (const smp of picks) {
          const times: number[] = [];
          let bakeMs: number | null = null;
          for (let k = 0; k < 35; k++) {
            const t0 = performance.now();
            r.render(smp.input, { pxPerCm: smp.pxPerCm * (1 + 0.01 * (k % 20)), offsetCm: [k * 0.013, k * 0.007], light: LIGHT, quality: q });
            gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
            if (k === 0) bakeMs = r.stats().bakeMs ?? null;
            if (k >= 5) times.push(performance.now() - t0);
          }
          times.sort((a, b) => a - b);
          rows.push({
            layered,
            quality: q,
            file: smp.file,
            method: 'sync-wall',
            frameMedianMs: +times[Math.floor(times.length / 2)].toFixed(2),
            frameWorstMs: +times[times.length - 1].toFixed(2),
            bakeMs: bakeMs === null ? null : +bakeMs.toFixed(1),
            tile: r.stats().tile,
          });
        }
      }
      r.dispose();
    }
    const med = (l: boolean, f: string, q: string) =>
      (rows.find((x) => x.layered === l && x.file === f && x.quality === q)?.frameMedianMs as number) ?? NaN;
    const overhead = picks.map((p) => ({
      file: p.file,
      highLayeredMs: med(true, p.file, 'high'),
      highSingleMs: med(false, p.file, 'high'),
      extraMs: +(med(true, p.file, 'high') - med(false, p.file, 'high')).toFixed(2),
    }));
    const summary = {
      gpu,
      size: SIZE,
      budgetMs: { navigation: 4 },
      note: 'gezinme karesi (döşeme önbellekten), duvar saati render + 1 piksel okuma; layered=false → RendererOptions.singleLayer (alt katman + kenar yumuşatma kapalı); extraMs = katmanlı çizimin ek maliyeti',
      layeredOverhead: overhead,
      rows,
    };
    await save(phase, 'perf.json', JSON.stringify(summary, null, 2), 'json');
    out.perf = { gpu, layeredOverhead: overhead };
    say('perf: ' + JSON.stringify(out.perf));
  }
  await save(phase, `${tag}.json`, JSON.stringify(out, null, 2), 'json');
  return out;
}

/**
 * Demo desenler (.atki.json, Durak 1): samples/realistic/demo/. Matris / dimi yönü doğrulaması için.
 *  - lhotse-natural.png: Tezgah | Mamul yan yana, lup ölçeği (100 px/mm), 1. bant sonu + 8b50… v5 bandı.
 *  - gardisette-bendix-varyant3.png / -varyant6.png: tam rapor yüksekliği (11 px/mm), varyant ADINA göre.
 *  - lhotse-v70-dimi.png: 4/4 dimi bandı (e29b… v70, atkı 106–145) tek başına, 40 px/mm; köşede ham matris
 *    (satır 0 altta, koyu = '1' = çözgü üstte).
 */
async function demoSnapshots(say: (t: string) => void) {
  const out: Record<string, unknown> = { light: LIGHT };
  const lh = DEMO_DESENLER.find((d) => d.key === 'lhotse-natural')!;
  const gd = DEMO_DESENLER.find((d) => d.key === 'gardisette-bendix-stripe')!;
  const specOf = (d: typeof lh, varyant: number) => atkiJsonToFabricSpec(d.json, { ...d, varyantIndex: varyant });
  const renderTo = (input: FabricInput, w: number, h: number, pxPerMm: number, offsetMm: [number, number]) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const r = createRealisticRenderer(c, { preserveDrawingBuffer: true });
    r.render(input, { pxPerCm: pxPerMm * 10, offsetCm: [offsetMm[0] / 10, offsetMm[1] / 10], light: LIGHT, quality: 'high' });
    const o = document.createElement('canvas');
    o.width = w;
    o.height = h;
    o.getContext('2d')!.drawImage(c, 0, 0);
    r.dispose();
    return o;
  };
  // 1) LHOTSE Tezgah | Mamul (lup ölçeği). Atkı 80–95: 1. bant sonu ve 8b50… v5 bandının başı.
  {
    const spec = specOf(lh, 0);
    const W = 768;
    const H = 768;
    const y0 = (80 / spec.weftDensityLoom) * 10;
    const loom = renderTo(fabricInputFromSpec(spec, undefined, { densities: 'loom' }), W, H, 100, [0, y0]);
    const fin = renderTo(fabricInputFromSpec(spec, undefined, { densities: 'finished' }), W, H, 100, [0, y0]);
    const c = document.createElement('canvas');
    c.width = 2 * W + 8;
    c.height = H;
    const g = c.getContext('2d')!;
    g.fillStyle = '#000';
    g.fillRect(0, 0, c.width, H);
    g.drawImage(loom, 0, 0);
    g.drawImage(fin, W + 8, 0);
    labelOn(g, 10, 10, 'Tezgah · LHOTSE NATURAL · 100 px/mm');
    labelOn(g, W + 18, 10, 'Mamul (çekme 0: .atki.json çekme taşımaz)');
    await save(0, 'lhotse-natural.png', c.toDataURL('image/png'), 'png');
    out.lhotse = { weftCount: spec.weave.length, warpRepeat: spec.weave[0].length, y0Mm: +y0.toFixed(2) };
  }
  // 2) Gardisette varyant 3 ve 6 (ada göre), tam rapor yüksekliği
  for (const adi of ['Varyant 3', 'Varyant 6']) {
    const k = gd.json.varyasyonlar.findIndex((v) => v.ad === adi);
    const spec = specOf(gd, k);
    const ppm = 11;
    const H = Math.round((spec.weave.length / spec.weftDensityLoom) * 10 * ppm);
    const cv = renderTo(fabricInputFromSpec(spec), 640, H, ppm, [0, 0]);
    const g = cv.getContext('2d')!;
    labelOn(g, 10, 10, `Gardisette Bendix Stripe · ${adi} · ${ppm} px/mm · tam rapor ${spec.weave.length} atkı`);
    await save(0, `gardisette-bendix-varyant${adi.slice(-1)}.png`, cv.toDataURL('image/png'), 'png');
  }
  // 3) LHOTSE 4/4 dimi bandı (v70) tek başına + ham matris
  {
    const spec = specOf(lh, 0);
    const o = lh.json.orguler.find((x) => orguAnahtari(x) === 'e29bafd6-8e71-4fc2-a4e6-6b5f2d8cf712@70')!;
    const pf = 10 / spec.weftDensityLoom;
    const ppm = 40;
    const H = Math.round(40 * pf * ppm);
    const cv = renderTo(fabricInputFromSpec(spec), 1024, H, ppm, [0, 106 * pf]);
    const g = cv.getContext('2d')!;
    // ham matris: satır 0 altta (kumaşta ilk atkı), koyu = '1' = çözgü üstte
    const cell = 16;
    const x0 = 1024 - 8 * cell - 16;
    const yb = H - 16;
    g.fillStyle = 'rgba(0,0,0,0.75)';
    g.fillRect(x0 - 8, yb - 8 * cell - 30, 8 * cell + 16, 8 * cell + 38);
    o.matris.rows.forEach((row, r) =>
      Array.from(row).forEach((ch, c) => {
        g.fillStyle = ch === '1' ? '#222' : '#ddd';
        g.fillRect(x0 + c * cell, yb - (r + 1) * cell, cell - 1, cell - 1);
      }),
    );
    g.fillStyle = '#fff';
    g.font = '12px system-ui, sans-serif';
    g.fillText("matris v70 (satır 0 altta, koyu = '1')", x0 - 4, yb - 8 * cell - 14);
    labelOn(g, 10, 10, 'LHOTSE 4/4 dimi bandı (e29b… v70, atkı 106–145) · 40 px/mm · rows[0] = bandın ilk (alt) atkısı');
    await save(0, 'lhotse-v70-dimi.png', cv.toDataURL('image/png'), 'png');
  }
  await save(0, 'demo.json', JSON.stringify(out, null, 2), 'json');
  say('demo: ' + JSON.stringify(out));
  return out;
}

/**
 * Bakış mesafesi + yayılma (Durak 2): samples/realistic/view-distance/.
 *  - <demo>-goz-uzak-lup.png: aynı merkez; Göz (40 cm) ve Uzak (2 m) fiziksel ölçekte (96 dpi × dpr 2 = 7.56 px/mm),
 *    Lup 100 px/mm. Göz / Uzak üstünde lup bölgesi çerçeveli.
 *  - <demo>-yayilma.png: lup, yayılma kapalı (sert yuvarlak kesit) ↔ açık.
 *  - report.json: görsel açıklık (zemin görünen piksel oranı; üst + alt katman kenar kapsaması) ↔ metrik açıklık
 *    (100 − örtme), yayılma kapalı / açık; demo desenler, açık doku, varsayılan örnek, bantlı çözgü.
 *  - perf.json: gezinme karesi (Göz / Uzak / Lup), duvar saati render + 1 piksel okuma.
 */
async function viewDistanceSnapshots(say: (t: string) => void) {
  const LIGHT_V = LIGHT;
  const DPR = 2;
  const physPpm = cssPxPerMm(1) * DPR;
  const demos = DEMO_DESENLER.map((d) => ({
    key: d.key,
    ad: d.ad,
    spec: atkiJsonToFabricSpec(d.json, { ...d, varyantIndex: d.key === 'gardisette-bendix-stripe' ? 5 : 0 }),
    // merkez (mm): LHOTSE dimi bandı (atkı ~126), Gardisette şerit geçişleri (atkı ~150)
    center: d.key === 'lhotse-natural' ? [6, (126 / 15) * 10] : [6, (150 / 20) * 10],
  }));
  const render = (input: FabricInput, w: number, h: number, ppm: number, center: number[], extra: Partial<ViewParams> = {}) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const r = createRealisticRenderer(c, { preserveDrawingBuffer: true });
    const off = [center[0] - w / 2 / ppm, center[1] - h / 2 / ppm];
    r.render(input, { pxPerCm: ppm * 10, offsetCm: [off[0] / 10, off[1] / 10], light: LIGHT_V, quality: 'high', ...extra });
    const o = document.createElement('canvas');
    o.width = w;
    o.height = h;
    o.getContext('2d')!.drawImage(c, 0, 0);
    r.dispose();
    return o;
  };
  const S = 640;
  const LUP = 100;
  for (const d of demos) {
    const input = fabricInputFromSpec(d.spec, undefined, { densities: 'finished' });
    // 1) Göz | Uzak | Lup
    {
      const eye = render(input, S, S, physPpm, d.center, { distance: 'eye' });
      const far = render(input, S, S, physPpm, d.center, { distance: 'far' });
      const lup = render(input, S, S, LUP, d.center, { distance: 'loupe' });
      const c = document.createElement('canvas');
      c.width = 3 * S + 16;
      c.height = S;
      const g = c.getContext('2d')!;
      g.fillStyle = '#000';
      g.fillRect(0, 0, c.width, S);
      [eye, far, lup].forEach((im, k) => g.drawImage(im, k * (S + 8), 0));
      // lup bölgesi çerçevesi (Göz / Uzak üstünde)
      const box = (S / LUP) * physPpm;
      g.strokeStyle = '#ff3b3b';
      g.lineWidth = 2;
      for (const k of [0, 1]) g.strokeRect(k * (S + 8) + S / 2 - box / 2, S / 2 - box / 2, box, box);
      const eb = viewBlurMm('eye', input);
      const fb = viewBlurMm('far', input);
      labelOn(g, 10, 10, `Göz 40 cm · gerçek ölçek · σ ${eb.toFixed(2)} mm (1′ = ${resolvableMm(VIEW_DISTANCE_MM.eye).toFixed(3)} mm)`);
      labelOn(g, S + 18, 10, `Uzak 2 m · gerçek ölçek · σ ${fb.toFixed(2)} mm (1′ = ${resolvableMm(VIEW_DISTANCE_MM.far).toFixed(3)} mm)`);
      labelOn(g, 2 * (S + 8) + 10, 10, `Lup · ${LUP} px/mm (kırmızı çerçeve)`);
      labelOn(g, 10, S - 34, `${d.ad} · ölçek 96 dpi × dpr ${DPR} = ${physPpm.toFixed(2)} px/mm`);
      await save(0, `${d.key}-goz-uzak-lup.png`, c.toDataURL('image/png'), 'png');
    }
    // 2) yayılma öncesi / sonrası (lup)
    {
      const before = render(input, S, S, LUP, d.center, { tuning: { spread: 0 } });
      const after = render(input, S, S, LUP, d.center, { tuning: { spread: 1 } });
      const c = document.createElement('canvas');
      c.width = 2 * S + 8;
      c.height = S;
      const g = c.getContext('2d')!;
      g.fillStyle = '#000';
      g.fillRect(0, 0, c.width, S);
      g.drawImage(before, 0, 0);
      g.drawImage(after, S + 8, 0);
      labelOn(g, 10, 10, 'Yayılma kapalı (sert yuvarlak kesit)');
      labelOn(g, S + 18, 10, 'Yayılma açık (tip + doluluk, hacim korunur)');
      await save(0, `${d.key}-yayilma.png`, c.toDataURL('image/png'), 'png');
    }
  }
  // 3) Görsel açıklık ↔ metrik
  const openness = (inp: FabricInput, spread: number) => {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 1024;
    const r = createRealisticRenderer(c, { preserveDrawingBuffer: true });
    let cov = 0;
    let n = 0;
    for (const off of [[0, 0], [1.3, 2.1], [0.7, 5.3]] as Array<[number, number]>) {
      r.render(inp, { pxPerCm: 400, offsetCm: off, light: LIGHT_V, quality: 'low', tuning: { spread } });
      const gb = r.readGBuffer();
      for (let k = 0; k < gb.gb1.length; k += 4) {
        const c1 = gb.gb1[k + 2] > 0.5 ? gb.gb1[k + 3] : 0;
        const y = gb.gb3 ? gb.gb3[k + 1] : 0;
        const ax2 = Math.floor(y + 1e-3);
        const c2 = ax2 > 0.5 ? Math.min(1, (y - ax2) / 0.9) : 0;
        cov += c1 + (1 - c1) * c2;
        n++;
      }
    }
    r.dispose();
    return +(100 * (1 - cov / n)).toFixed(1);
  };
  const cases: Array<{ name: string; spec?: FabricSpec; input: FabricInput; metricPct: number }> = [];
  for (const d of demos) cases.push({ name: d.key, spec: d.spec, input: fabricInputFromSpec(d.spec, undefined, { densities: 'finished' }), metricPct: 100 - computeMetrics(d.spec).cover });
  cases.push({ name: 'acik-coklu-atki', spec: acikSpec, input: fabricInputFromSpec(acikSpec, undefined, { densities: 'finished' }), metricPct: 100 - computeMetrics(acikSpec).cover });
  const ex = physicalExample(6, 10);
  cases.push({ name: 'varsayilan-ornek', spec: ex, input: fabricInputFromSpec(ex, undefined, { densities: 'finished' }), metricPct: 100 - computeMetrics(ex).cover });
  {
    // bantlı çözgü: FabricSpec yok; aynı Peirce örtme formülü (metrics.ts: c = sıklık/10 · d)
    const dB = yarnDiameterMm(yarnToTex(20, 'Ne'));
    const m = 100 * (1 - Math.min(1, (bandedInput.density.warpPerCm / 10) * dB)) * (1 - Math.min(1, (bandedInput.density.weftPerCm / 10) * dB));
    cases.push({ name: 'banded-warp', input: bandedInput, metricPct: m });
  }
  const rows = cases.map((c) => {
    const rigid = openness(c.input, 0);
    const spread = openness(c.input, 1);
    return { name: c.name, metricPct: +c.metricPct.toFixed(1), visualRigidPct: rigid, visualSpreadPct: spread, diffSpread: +(spread - c.metricPct).toFixed(1), within3: Math.abs(spread - c.metricPct) <= 3 };
  });
  const report = {
    note: 'Görsel açıklık = zemin görünen piksel oranı (üst katman kapsaması + alt katmanın kenar kapsaması), 40 px/mm, üç pencere ortalaması. Metrik açıklık = 100 − örtme (metrics.ts, Peirce: mamul sıklığı × yuvarlak çap).',
    acceptance: 'yayılma açıkken |görsel − metrik| ≤ 3 puan',
    allWithin3: rows.every((r) => r.within3),
    rows,
  };
  await save(0, 'report.json', JSON.stringify(report, null, 2), 'json');
  say('açıklık: ' + JSON.stringify(rows));
  // 4) Performans
  {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 1024;
    const gl0 = c.getContext('webgl2') as WebGL2RenderingContext;
    const dbg = gl0.getExtension('WEBGL_debug_renderer_info');
    const gpu = dbg ? String(gl0.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(gl0.getParameter(gl0.RENDERER));
    const r = createRealisticRenderer(c, {});
    const px = new Uint8Array(4);
    const rows2: Record<string, unknown>[] = [];
    for (const d of demos) {
      const input = fabricInputFromSpec(d.spec, undefined, { densities: 'finished' });
      for (const dist of ['eye', 'far', 'loupe'] as const) {
        const ppm = dist === 'loupe' ? LUP : physPpm;
        const times: number[] = [];
        let bakeMs: number | null = null;
        for (let k = 0; k < 35; k++) {
          const t0 = performance.now();
          // gezinme: merkez kayar (lup'ta pencere dışına çıkınca yeniden pişer — en kötü kare buna bakar)
          const cx = d.center[0] + k * 0.05;
          const cy = d.center[1] + k * 0.08;
          r.render(input, { pxPerCm: ppm * 10, offsetCm: [(cx - 512 / ppm) / 10, (cy - 512 / ppm) / 10], light: LIGHT_V, quality: 'high', distance: dist });
          gl0.readPixels(0, 0, 1, 1, gl0.RGBA, gl0.UNSIGNED_BYTE, px);
          if (k === 0) bakeMs = r.stats().bakeMs ?? null;
          if (k >= 5) times.push(performance.now() - t0);
        }
        times.sort((a, b) => a - b);
        rows2.push({
          file: d.key,
          distance: dist,
          method: 'sync-wall',
          frameMedianMs: +times[Math.floor(times.length / 2)].toFixed(2),
          frameWorstMs: +times[times.length - 1].toFixed(2),
          bakeMs: bakeMs === null ? null : +bakeMs.toFixed(1),
          tile: r.stats().tile,
        });
      }
    }
    r.dispose();
    const perfOut = { gpu, size: 1024, budgetMs: { navigation: 4 }, note: 'Göz / Uzak: pişirilmiş düşük çözünürlüklü renk döşemesi + 3×3 ön filtre; Lup: ekran G-buffer + ışık (uzun raporda görünür pencere pişirilir)', rows: rows2 };
    await save(0, 'perf.json', JSON.stringify(perfOut, null, 2), 'json');
    say('perf: ' + JSON.stringify(rows2.map((x) => [x.file, x.distance, x.frameMedianMs, x.bakeMs])));
  }
  return report;
}

async function run() {
  const tagParam = new URLSearchParams(location.search).get('phase') ?? '1';
  if (tagParam === 'view-distance') {
    SAVE_TAG = 'view-distance';
    const say = (t: string) => (document.getElementById('log')!.textContent += t + '\n');
    window.__snapshotsReport = await viewDistanceSnapshots(say);
    window.__snapshotsDone = true;
    say('Bitti.');
    return;
  }
  if (tagParam === 'demo') {
    SAVE_TAG = 'demo';
    const say = (t: string) => (document.getElementById('log')!.textContent += t + '\n');
    window.__snapshotsReport = await demoSnapshots(say);
    window.__snapshotsDone = true;
    say('Bitti.');
    return;
  }
  const fixTag = /^fix-v\d+$/.test(tagParam) ? tagParam : null;
  // Düzeltme turu tüm kontrolleri (faz 6 dahil) çalıştırır
  const phase = fixTag ? 6 : Math.max(1, parseInt(tagParam, 10) || 1);
  SAVE_TAG = fixTag ?? phase;
  const log = document.getElementById('log')!;
  const grid = document.getElementById('grid')!;
  const say = (t: string) => (log.textContent += t + '\n');
  const report: Record<string, unknown> = { phase, size: SIZE, supported: isRealisticSupported(), samples: [] as unknown[] };
  say(`Faz ${phase} · WebGL2 desteği: ${report.supported}`);
  if (!report.supported) {
    await save(phase, 'report.json', JSON.stringify(report, null, 2), 'json');
    window.__snapshotsReport = report;
    window.__snapshotsDone = true;
    return;
  }
  // fix-v3 (ve sonrası): yalnız bu turun hedefli snapshot'ları
  if (fixTag && fixTag !== 'fix-v2') {
    report.fixV3 = await fixV3(phase, say, fixTag);
    await save(phase, 'report.json', JSON.stringify(report, null, 2), 'json');
    window.__snapshotsReport = report;
    window.__snapshotsDone = true;
    say('Bitti.');
    return;
  }
  for (const s of SAMPLES) {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const r = createRealisticRenderer(canvas, { preserveDrawingBuffer: true, debugView: phase === 1 ? 'flat' : phase === 2 ? 'preview' : 'lit' });
    const view: ViewParams = { pxPerCm: s.pxPerCm, offsetCm: [0, 0], light: LIGHT, quality: 'high', ...(s.tuning ? { tuning: s.tuning } : {}) };
    const t0 = performance.now();
    r.render(s.input, view);
    const pixels = r.readPixels(); // readPixels GPU'yu bekletir; süre kaba ölçümdür
    const ms = performance.now() - t0;
    const entry: Record<string, unknown> = { file: s.file, title: s.title, pxPerCm: s.pxPerCm, ms: +ms.toFixed(2) };
    if (phase === 1) Object.assign(entry, compareFlat(pixels, s.input, view));
    if (phase >= 2) entry.consistency = consistency(s);
    if (phase >= 4) entry.determinism = determinism(s, view, pixels);
    await save(phase, s.file, canvas.toDataURL('image/png'), 'png');
    (report.samples as unknown[]).push(entry);
    say(`${s.file}: ${JSON.stringify(entry)}`);
    const fig = document.createElement('figure');
    const img = new Image();
    img.src = canvas.toDataURL('image/png');
    img.width = 256;
    fig.append(img, Object.assign(document.createElement('figcaption'), { textContent: s.title }));
    grid.append(fig);
    r.dispose();
  }
  if (phase >= 4) {
    const det = (report.samples as Array<{ file: string; determinism?: { pass: boolean } }>).map((e) => ({ file: e.file, ...e.determinism }));
    const summary = { allPass: det.every((d) => (d as { pass?: boolean }).pass), samples: det };
    await save(phase, 'determinism.json', JSON.stringify(summary, null, 2), 'json');
    say('Determinizm: ' + (summary.allPass ? 'GEÇTİ' : 'KALDI'));
  }
  if (phase >= 2) {
    const list = (report.samples as Array<{ consistency?: { pass: boolean } }>).map((e) => e.consistency);
    const summary = { allPass: list.every((c) => c && c.pass), samples: list };
    await save(phase, 'consistency.json', JSON.stringify(summary, null, 2), 'json');
    say('Tutarlılık: ' + (summary.allPass ? 'GEÇTİ' : 'KALDI'));
  }
  if (phase >= 5) report.calibration = await calibration(phase, say);
  if (phase >= 6) report.perf = await perf(phase, say);
  if (fixTag) report.fixV2 = await fixV2(phase, say);
  await save(phase, 'report.json', JSON.stringify(report, null, 2), 'json');
  window.__snapshotsReport = report;
  window.__snapshotsDone = true;
  say('Bitti.');
}

run().catch((e) => {
  document.getElementById('log')!.textContent += 'HATA: ' + (e as Error).message + '\n';
  window.__snapshotsReport = { error: (e as Error).message };
  window.__snapshotsDone = true;
});
