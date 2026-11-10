/**
 * Paketleme turu snapshot'ları: /dev/realistic-snapshots?phase=packing&stage=once|sonra → samples/realistic/packing/
 *  - <stage>-bendix-lup.png: Gardisette Bendix Stripe v3, Tezgah, lup 60 px/mm; sol klasik heightfield, sağ gerçekçi.
 *  - <stage>-banded-lup.png: bantlı çözgü fixture'ı, lup 60 px/mm; sol klasik, sağ gerçekçi.
 *  - <stage>-tarak-<rapor>-{uzak,yakin}.png: Bendix v3 + tarak (aynı ortalama 20 tel/cm), klasik | gerçekçi.
 *  - <stage>-cekme-moire.png: klasik mamul (çözgü %15, atkı %22.5) 2 / 5 / 9 px/mm.
 *  - <stage>-packing.json: görsel kaplama (gerçekçi) ↔ klasik açıklık, tarak metrikleri, uygulanan çekme, moiré ölçüsü.
 */
import { createRealisticRenderer } from '../index';
import { simulatePhysical } from '../../render-engine/physical/simulate';
import { computeMetrics, structureMetrics } from '../../render-engine/physical/metrics';
import { physicalExample } from '../../presets/physicalExample';
import type { FabricSpec } from '../../render-engine/types';
import type { FabricInput, ViewParams } from '../types';
import { fabricInputFromSpec } from '../adapters/fromSpec';
import { DEMO_DESENLER } from '../../app/demoDesenler';
import { atkiJsonToFabricSpec } from '../../adapters/atkiJson';
import { expandBandedFixture, type BandedFixture } from '../fixtures';
import banded from '../../../fixtures/banded-warp-sample.json';

const LIGHT = { azimuthDeg: 135, elevationDeg: 45 };

async function save(name: string, body: string, kind: 'png' | 'json') {
  const res = await fetch('/__realistic/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phase: 'packing', name, kind, data: body }),
  });
  if (!res.ok) throw new Error(`${name} kaydedilemedi: ${res.status} ${await res.text()}`);
}

function label(ctx: CanvasRenderingContext2D, x: number, y: number, t: string) {
  ctx.font = '15px system-ui, sans-serif';
  const w = ctx.measureText(t).width + 14;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(x, y, w, 22);
  ctx.fillStyle = '#fff';
  ctx.fillText(t, x + 7, y + 16);
}

function bendixSpec(): FabricSpec {
  const d = DEMO_DESENLER.find((x) => x.key === 'gardisette-bendix-stripe')!;
  const k = d.json.varyasyonlar.findIndex((v) => v.ad === 'Varyant 3');
  return atkiJsonToFabricSpec(d.json, { ...d, varyantIndex: k });
}

/** Bantlı fixture → klasik render için FabricSpec (2 slot yaklaşık: krem çözgü / koyu atkı yerine renk dizisi). */
function bandedSpec(inp: FabricInput): FabricSpec {
  const warps = inp.weave.warps;
  const wefts = inp.weave.wefts;
  const weave: boolean[][] = [];
  for (let r = 0; r < wefts; r++) weave.push(Array.from({ length: warps }, (_, c) => inp.weave.data[r * warps + c] === 1));
  const colors = [...new Set(inp.warp.map((w) => w.color))].slice(0, 4);
  const fColors = [...new Set(inp.weft.map((w) => w.color))].slice(0, 4);
  const nearest = (list: string[], c: string) => Math.max(0, list.indexOf(c));
  const slot = (color: string) => ({ color, count: 20, system: 'Ne' as const, twist: 'Z' as const });
  return {
    version: 2,
    weave,
    warpSlots: colors.map(slot),
    weftSlots: fColors.map(slot),
    warpSequence: inp.warp.map((w) => nearest(colors, w.color)),
    weftSequence: inp.weft.map((w) => nearest(fColors, w.color)),
    warpDensityLoom: inp.density.warpPerCm,
    weftDensityLoom: inp.density.weftPerCm,
    warpShrinkPct: 0,
    weftShrinkPct: 0,
    warpCrimpShare: 0.5,
  } as unknown as FabricSpec;
}

function realistic(input: FabricInput, w: number, h: number, ppm: number, offMm: [number, number], extra: Partial<ViewParams> = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const r = createRealisticRenderer(c, { preserveDrawingBuffer: true });
  r.render(input, { pxPerCm: ppm * 10, offsetCm: [offMm[0] / 10, offMm[1] / 10], light: LIGHT, quality: 'high', ...extra });
  const o = document.createElement('canvas');
  o.width = w;
  o.height = h;
  o.getContext('2d')!.drawImage(c, 0, 0);
  r.dispose();
  return o;
}

/** Gerçekçi lup kaplaması (%): üst katman kapsaması + alt katman kenar kapsaması, 3 pencere. */
function realisticOpenPct(input: FabricInput, ppm: number): number {
  const c = document.createElement('canvas');
  c.width = 768;
  c.height = 768;
  const r = createRealisticRenderer(c, { preserveDrawingBuffer: true });
  let cov = 0;
  let n = 0;
  for (const off of [[0, 0], [1.3, 2.1], [0.7, 5.3]] as Array<[number, number]>) {
    r.render(input, { pxPerCm: ppm * 10, offsetCm: [off[0] / 10, off[1] / 10], light: LIGHT, quality: 'low' });
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
}

function classic(spec: FabricSpec, w: number, h: number, ppm: number, offMm: [number, number], supersample?: number) {
  const res = simulatePhysical(
    spec,
    { x0Mm: offMm[0], y0Mm: offMm[1], widthMm: w / ppm, heightMm: h / ppm, pxPerMm: ppm },
    { scaleBar: false, ...(supersample !== undefined ? ({ supersample } as object) : {}) },
  );
  const c = document.createElement('canvas');
  c.width = res.image.width;
  c.height = res.image.height;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(res.image.data), res.image.width, res.image.height), 0, 0);
  return { canvas: c, openPct: res.openPct, image: res.image };
}

/** Moiré ölçüsü: satır ortalaması parlaklığının 2..8 piksellik periyotlu bileşenlerinin gücü / toplam varyans. */
function moireIndex(img: { width: number; height: number; data: Uint8ClampedArray | Uint8Array }): number {
  const { width: w, height: h, data } = img;
  const rows: number[] = [];
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = 0; x < w; x++) {
      const o = 4 * (y * w + x);
      s += 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
    }
    rows.push(s / w);
  }
  const cols: number[] = [];
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = 0; y < h; y++) {
      const o = 4 * (y * w + x);
      s += 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
    }
    cols.push(s / h);
  }
  // Düşük frekans (≥ 12 piksel) çıkar: kalan = ızgara girişimi; std olarak (gri seviye)
  const hp = (a: number[]) => {
    const out: number[] = [];
    for (let i = 0; i < a.length; i++) {
      let s = 0;
      let n = 0;
      for (let k = -6; k <= 6; k++) {
        const j = i + k;
        if (j >= 0 && j < a.length) {
          s += a[j];
          n++;
        }
      }
      out.push(a[i] - s / n);
    }
    const m = out.reduce((p, v) => p + v, 0) / out.length;
    return Math.sqrt(out.reduce((p, v) => p + (v - m) ** 2, 0) / out.length);
  };
  // Satır ortalamalarında beklenen (fiziksel) atkı deseni de var; ölçü: satır + sütun yüksek geçiren std
  return +(hp(rows) + hp(cols)).toFixed(2);
}

export async function packingSnapshots(stage: string, say: (t: string) => void) {
  const out: Record<string, unknown> = { stage };
  const W = 640;
  const H = 480;
  const LUP = 60;
  const pairs = async (name: string, spec: FabricSpec, input: FabricInput, offMm: [number, number], title: string) => {
    const cl = classic(spec, W, H, LUP, offMm);
    const re = realistic(input, W, H, LUP, [offMm[0], offMm[1]]);
    const c = document.createElement('canvas');
    c.width = 2 * W + 8;
    c.height = H;
    const g = c.getContext('2d')!;
    g.fillStyle = '#000';
    g.fillRect(0, 0, c.width, H);
    g.drawImage(cl.canvas, 0, 0);
    g.drawImage(re, W + 8, 0);
    label(g, 10, 10, `Klasik heightfield · ${title} · ${LUP} px/mm`);
    label(g, W + 18, 10, `Gerçekçi lup (${stage})`);
    await save(`${stage}-${name}.png`, c.toDataURL('image/png'), 'png');
    return { classicOpenPct: +cl.openPct.toFixed(1), realisticOpenPct: realisticOpenPct(input, LUP) };
  };
  // 1) Bendix v3 (Tezgah) ve bantlı çözgü lup
  const bx = { ...bendixSpec(), warpShrinkPct: 0, weftShrinkPct: 0 };
  out.bendix = await pairs('bendix-lup', bx, fabricInputFromSpec(bx, undefined, { densities: 'loom' }), [0.4, 10], 'Bendix v3 Tezgah');
  const bInp = expandBandedFixture(banded as BandedFixture);
  out.banded = await pairs('banded-lup', bandedSpec(bInp), bInp, [0.4, 0.4], 'bantlı çözgü');
  say('lup: ' + JSON.stringify({ bendix: out.bendix, banded: out.banded }));

  // 2) Tarak: aynı ortalama sıklık (20 tel/cm) için diş sıklığı = 20 / ortalama uç
  const reedRows: Record<string, unknown>[] = [];
  for (const rep of [[4, 0], [2, 2, 3, 0]]) {
    const avg = rep.reduce((a, b) => a + b, 0) / rep.length;
    const spec: FabricSpec = { ...bx, reed: { reedNumber: +(bx.warpDensityLoom / avg).toFixed(3), dentingReport: rep } };
    const tag = rep.join('-');
    const input = fabricInputFromSpec(spec, undefined, { densities: 'loom' });
    for (const [kind, ppm] of [['uzak', 7.56], ['yakin', 40]] as Array<[string, number]>) {
      const cl = classic(spec, W, H, ppm, [0, 6]);
      const re = realistic(input, W, H, ppm, [0, 6], kind === 'uzak' ? { distance: 'eye' } : { distance: 'loupe' });
      const c = document.createElement('canvas');
      c.width = 2 * W + 8;
      c.height = H;
      const g = c.getContext('2d')!;
      g.fillStyle = '#000';
      g.fillRect(0, 0, c.width, H);
      g.drawImage(cl.canvas, 0, 0);
      g.drawImage(re, W + 8, 0);
      label(g, 10, 10, `Klasik · tarak ${tag} (${spec.reed!.reedNumber} diş/cm) · ${ppm} px/mm`);
      label(g, W + 18, 10, `Gerçekçi · ${kind === 'uzak' ? 'Göz 40 cm' : 'Lup'} (${stage})`);
      await save(`${stage}-tarak-${tag}-${kind}.png`, c.toDataURL('image/png'), 'png');
    }
    const m = computeMetrics(spec) as unknown as Record<string, unknown>;
    reedRows.push({ report: tag, reedNumber: spec.reed!.reedNumber, cover: m.cover, openPct: m.openPct ?? null, openTheoretical: m.openTheoretical ?? null });
  }
  out.reed = reedRows;
  say('tarak: ' + JSON.stringify(reedRows));

  // 3) Klasik mamul çekme moiré: çözgü %15, atkı %22.5 (fiziksel sınırın üstü)
  {
    const spec: FabricSpec = { ...bendixSpec(), warpShrinkPct: 15, weftShrinkPct: 22.5 };
    const m = computeMetrics(spec) as unknown as Record<string, unknown>;
    const rows: Record<string, unknown>[] = [];
    const PW = 420;
    const PH = 320;
    const c = document.createElement('canvas');
    c.width = 3 * PW + 16;
    c.height = PH;
    const g = c.getContext('2d')!;
    g.fillStyle = '#000';
    g.fillRect(0, 0, c.width, PH);
    let k = 0;
    for (const ppm of [2, 5, 9]) {
      const cl = classic(spec, PW, PH, ppm, [0, 0]);
      g.drawImage(cl.canvas, k * (PW + 8), 0);
      const mi = moireIndex(cl.image);
      label(g, k * (PW + 8) + 8, 8, `Mamul · ${ppm} px/mm · moiré ${mi}`);
      rows.push({ pxPerMm: ppm, moire: mi, size: [cl.image.width, cl.image.height] });
      k++;
    }
    await save(`${stage}-cekme-moire.png`, c.toDataURL('image/png'), 'png');
    // Çekme sınırı: Bendix'te %22.5 ulaşılabilir; sınırı aşan örnek (dobby varsayılan örnek, %15 / %22.5)
    const ex = physicalExample(15, 22.5);
    const mx = computeMetrics(ex) as unknown as Record<string, unknown>;
    const sx = structureMetrics(ex);
    out.shrink = {
      entered: { warp: 15, weft: 22.5 },
      bendixApplied: m.appliedShrinkPct ?? null,
      bendixMax: { warp: structureMetrics(spec).maxWarpShrinkPct, weft: structureMetrics(spec).maxWeftShrinkPct },
      clampExample: { applied: mx.appliedShrinkPct ?? null, Dw: mx.Dw, Df: mx.Df, warnings: sx.warnings },
      rows,
    };
    say('çekme: ' + JSON.stringify(out.shrink));
  }
  await save(`${stage}-packing.json`, JSON.stringify(out, null, 2), 'json');
  return out;
}
