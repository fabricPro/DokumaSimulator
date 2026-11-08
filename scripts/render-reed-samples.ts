/**
 * Tarak örnekleri: tarak şeridi + Tezgah | Mamul ("Aynı iplikler"), hepsi aynı px/mm.
 * Her kombinasyon %0 / %8 / %15 çekmede (çözgü ve atkı eşit). İplik 300 den.
 * Karşılaştırılabilirlik için tüm kombinasyonlar 12 tel/cm tezgah çözgü sıklığında:
 *   bezayağı + 2'li düz (6'lık tarak), panama + 2'li düz (6'lık tarak),
 *   3×3 yalancı lino + 3-0-0 (12'lik tarak), 3×3 yalancı lino + 1'li düz (12'lik tarak).
 * Not: 20'lik tarakta 3 × 300 den (Σ çap 0.67 mm) 0.35 mm diş açıklığına sığmaz; sığmama uyarısı verir.
 *
 *   npm run samples:reed  → samples/reed/<ad>_<çekme>.png, <ad>_ozet.png, metrics.json
 */
import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildFabricPositions,
  computeMetrics,
  mapLoomToFinished,
  simulatePhysical,
  slotOf,
  structureMetrics,
  type FabricSpec,
  type ReedSpec,
  type RgbaImage,
} from '../src/render-engine';
import { hopsack, mockLeno3, plain } from '../src/presets/weaves';
import { DENT_BAND, LINK_BAND, drawReedStrip, type StripContext } from '../src/app/reedStrip';

const OUT = join('samples', 'reed');
const VIEW_MM = 8;
const PPM = 90;
const SHRINKS = [0, 8, 15];

function base(weave: boolean[][], reed: ReedSpec): FabricSpec {
  return {
    version: 2,
    weave,
    warpSlots: [{ name: 'A', count: 300, system: 'Denier', color: '#e8e6e1', twist: 'S' }],
    weftSlots: [{ name: 'A', count: 300, system: 'Denier', color: '#4a5058', twist: 'S' }],
    warpSequence: [0],
    weftSequence: [0],
    warpDensityLoom: 12,
    weftDensityLoom: 12,
    warpShrinkPct: 0,
    weftShrinkPct: 0,
    warpCrimpShare: 0.4,
    reed,
  };
}

const sets: Array<[string, string, FabricSpec]> = [
  ['bezayagi_2li', "Bezayağı + 2'li düz (6 diş/cm)", base(plain(), { reedNumber: 6, dentingReport: [2] })],
  ['panama_2li', "Panama 2/2 + 2'li düz (6 diş/cm)", base(hopsack(), { reedNumber: 6, dentingReport: [2] })],
  ['yalanci_lino_3-0-0', '3×3 yalancı lino + 3-0-0 (12 diş/cm)', base(mockLeno3(), { reedNumber: 12, dentingReport: [3, 0, 0] })],
  ['yalanci_lino_1li', "3×3 yalancı lino + 1'li düz (12 diş/cm)", base(mockLeno3(), { reedNumber: 12, dentingReport: [1] })],
];

function put(ctx: SKRSContext2D, img: RgbaImage, x: number, y: number) {
  const id = ctx.createImageData(img.width, img.height);
  id.data.set(img.data);
  ctx.putImageData(id, x, y);
}

function label(ctx: SKRSContext2D, x: number, y: number, lines: string[]) {
  ctx.font = '14px sans-serif';
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
  ctx.fillStyle = 'rgba(0,0,0,0.8)';
  ctx.fillRect(x, y, w, lines.length * 19 + 10);
  ctx.fillStyle = 'rgb(235,235,235)';
  lines.forEach((l, i) => ctx.fillText(l, x + 8, y + 20 + i * 19));
}

function scaleBar(ctx: SKRSContext2D, x: number, y: number) {
  ctx.fillStyle = 'rgb(240,240,240)';
  ctx.fillRect(x, y, PPM, 6);
  ctx.font = '13px sans-serif';
  ctx.fillText('1 mm', x, y - 6);
}

mkdirSync(OUT, { recursive: true });
const N = Math.trunc(VIEW_MM * PPM);
const BAND = DENT_BAND + LINK_BAND;
const all: Record<string, unknown> = {};
for (const [id, title, spec0] of sets) {
  const summary = createCanvas(N * SHRINKS.length + 16 * (SHRINKS.length - 1), BAND + N + 40);
  const sctx = summary.getContext('2d');
  sctx.fillStyle = '#ffffff';
  sctx.fillRect(0, 0, summary.width, summary.height);
  const colorOf = (g: number) => spec0.warpSlots[slotOf(spec0.warpSequence, g, spec0.warpSlots.length)].color;
  SHRINKS.forEach((s, si) => {
    const spec = { ...spec0, warpShrinkPct: s, weftShrinkPct: s };
    const loomSpec = { ...spec0, warpShrinkPct: 0, weftShrinkPct: 0 };
    const pos = buildFabricPositions(spec);
    const reed = pos.reed!;
    const loom = simulatePhysical(loomSpec, { x0Mm: 0, y0Mm: 0, widthMm: VIEW_MM, heightMm: VIEW_MM, pxPerMm: PPM }, { seed: 3, scaleBar: false });
    const fx0 = mapLoomToFinished(pos.warp, 0);
    const fy0 = mapLoomToFinished(pos.weft, 0);
    const fx1 = mapLoomToFinished(pos.warp, VIEW_MM);
    const fy1 = mapLoomToFinished(pos.weft, VIEW_MM);
    const fin = simulatePhysical(
      spec,
      { x0Mm: fx0, y0Mm: fy0, widthMm: fx1 - fx0, heightMm: fy1 - fy0, pxPerMm: PPM },
      { seed: 3, scaleBar: false, positions: pos },
    );
    const m = computeMetrics(spec);
    const st = structureMetrics(spec, pos);

    const c = createCanvas(N * 2 + 16, BAND + N);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#090a0d';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(N, 0, 16, c.height);
    // Tezgah: şerit + kumaş (aynı x eşlemesi: 0 mm → 0 px)
    put(ctx, loom.image, 0, BAND);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, N, BAND);
    ctx.clip();
    drawReedStrip(ctx as unknown as StripContext, { reed, colorOf }, N, PPM, 0, 0);
    ctx.restore();
    // Mamul: şerit (tezgah konumları) + bağlantı çizgileri + kumaş sol alta hizalı
    ctx.save();
    ctx.translate(N + 16, 0);
    ctx.beginPath();
    ctx.rect(0, 0, N, BAND + N);
    ctx.clip();
    drawReedStrip(ctx as unknown as StripContext, { reed, colorOf, finished: pos.warp.finished, loomOriginX: 0 }, N, PPM, 0, fx0);
    ctx.restore();
    put(ctx, fin.image, N + 16, BAND + N - fin.image.height);
    scaleBar(ctx, 12, BAND + N - 24);
    scaleBar(ctx, N + 28, BAND + N - 24);
    label(ctx, 8, BAND + 8, [`${title} — Tezgah`, `açıklık %${loom.openPct.toFixed(1)}`]);
    label(ctx, N + 24, BAND + 8, [
      `Mamul (aynı iplikler) — çekme %${s} / %${s}`,
      `${m.Dw.toFixed(1)} × ${m.Df.toFixed(1)} tel/cm, açıklık %${fin.openPct.toFixed(1)}`,
      `en büyük gözenek ${st.poreMm[0].toFixed(2)} × ${st.poreMm[1].toFixed(2)} mm`,
      `grup genişliği ç/a ${st.warp.meanGroupWidthMm.toFixed(2)} / ${st.weft.meanGroupWidthMm.toFixed(2)} mm`,
      ...(st.feasible ? [] : ['ULAŞILAMAZ çekme']),
      ...st.warnings.slice(0, 2),
    ]);
    writeFileSync(join(OUT, `${id}_${String(s).padStart(2, '0')}.png`), c.toBuffer('image/png'));

    // Özet: mamul (şeritli, çizgili) yan yana
    const ox = si * (N + 16);
    sctx.save();
    sctx.translate(ox, 0);
    sctx.fillStyle = '#090a0d';
    sctx.fillRect(0, 0, N, BAND + N);
    sctx.beginPath();
    sctx.rect(0, 0, N, BAND + N);
    sctx.clip();
    drawReedStrip(sctx as unknown as StripContext, { reed, colorOf, finished: pos.warp.finished, loomOriginX: 0 }, N, PPM, 0, fx0);
    sctx.restore();
    put(sctx, fin.image, ox, BAND + N - fin.image.height);
    sctx.fillStyle = '#111';
    sctx.font = '16px sans-serif';
    sctx.fillText(`${title} — çekme %${s}`, ox + 4, BAND + N + 26);

    // Hiza kontrolü: tezgahta her çözgü merkezi kendi diş açıklığında
    const r = reed.indexRange(0, VIEW_MM);
    let misaligned = 0;
    for (let g = r.first; g < r.first + r.count; g++) {
      const d = reed.dentAt(reed.dentOfWarp(g));
      const x = reed.centers(g, 1)[0];
      if (!(x > d.openLeft && x < d.openRight)) misaligned++;
    }
    all[`${id}_${s}`] = {
      title,
      shrinkPct: s,
      loomWarpDensity: pos.reedDensity,
      Dw: m.Dw,
      Df: m.Df,
      openPctLoom: loom.openPct,
      openPct: fin.openPct,
      poreMm: st.poreMm,
      groupWidthMm: [st.warp.meanGroupWidthMm, st.weft.meanGroupWidthMm],
      feasible: st.feasible,
      misalignedWarps: misaligned,
      warnings: st.warnings,
    };
    console.log(
      `${id.padEnd(20)} %${String(s).padStart(2)}  açıklık ${loom.openPct.toFixed(1).padStart(5)} → ${fin.openPct.toFixed(1).padStart(5)}  ` +
        `gözenek ${st.poreMm[0].toFixed(2)}×${st.poreMm[1].toFixed(2)} mm  grup ${st.warp.meanGroupWidthMm.toFixed(2)} mm  hiza hatası ${misaligned}` +
        (st.feasible ? '' : '  ULAŞILAMAZ'),
    );
  });
  writeFileSync(join(OUT, `${id}_ozet.png`), summary.toBuffer('image/png'));
}
writeFileSync(join(OUT, 'metrics.json'), JSON.stringify(all, null, 2));
