/**
 * Atkı yönü örnekleri: kullanıcı 6×6 ve 3×3 yalancı lino, kullanıcının iplikleri (çözgü A-B-A, atkı A-B),
 * 8 diş/cm tarak, 3-0 taraklama. Çözgü çekmesi %0 / %15 / %30 × atkı çekmesi %0 / %10.
 * "Aynı iplikler" düzeni: Tezgah | Mamul (mamul dikeyde ortalı), tarak şeridi + çözgü bağlantı çizgileri,
 * solda atkı bağlantı çizgileri, kenarlarda w şeritleri (0 yeşil → 1 kırmızı).
 *
 *   npm run samples:weft → samples/weft/<örgü>_c<çözgü>_a<atkı>.png, <örgü>_ozet.png, metrics.json
 */
import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildFabricPositions,
  computeMetrics,
  mapLoomToFinished,
  simulatePhysical,
  slotOf,
  structureMetrics,
  type AxisPositions,
  type FabricSpec,
  type PositionGenerator,
  type RgbaImage,
} from '../src/render-engine';
import { parseFabricJson } from '../src/importers/fabricJson';
import { mockLeno3 } from '../src/presets/weaves';
import { DENT_BAND, LINK_BAND, drawReedStrip, type StripContext } from '../src/app/reedStrip';

const USER_FILE = join('samples', 'input', 'kullanici-6x6.json');
if (!existsSync(USER_FILE)) {
  console.error(`HATA: ${USER_FILE} bulunamadı.`);
  process.exit(1);
}
const user = parseFabricJson(readFileSync(USER_FILE, 'utf-8')).spec;
const OUT = join('samples', 'weft');
const VIEW_MM = 8;
const PPM = 80;
const WARP_SHRINK = [0, 15, 30];
const WEFT_SHRINK = [0, 10];
const LEFT = 26; // atkı bağlantı bandı
const STRIP = 6;

// Ortak ayarlar: kullanıcının iplikleri, çözgü A-B-A, atkı A-B, 8 diş/cm 3-0
const common: Omit<FabricSpec, 'weave'> = {
  version: 2,
  warpSlots: user.warpSlots,
  weftSlots: user.weftSlots.length > 1 ? user.weftSlots : [user.weftSlots[0], { ...user.weftSlots[0], name: 'B', color: '#3d434b' }],
  warpSequence: [0, 1, 0],
  weftSequence: [0, 1],
  warpDensityLoom: 12,
  weftDensityLoom: user.weftDensityLoom,
  warpShrinkPct: 0,
  weftShrinkPct: 0,
  warpCrimpShare: 0.4,
  reed: { reedNumber: 8, reedUnit: 'diş/cm', dentingReport: [3, 0] },
};
const sets: Array<[string, string, FabricSpec]> = [
  ['kullanici_6x6', 'Kullanıcı 6×6', { ...common, weave: user.weave }],
  ['yalanci_lino_3x3', '3×3 yalancı lino', { ...common, weave: mockLeno3() }],
];

function put(ctx: SKRSContext2D, img: RgbaImage, x: number, y: number) {
  const id = ctx.createImageData(img.width, img.height);
  id.data.set(img.data);
  ctx.putImageData(id, x, y);
}
function label(ctx: SKRSContext2D, x: number, y: number, lines: string[], color = 'rgb(235,235,235)') {
  ctx.font = '13px sans-serif';
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 14;
  ctx.fillStyle = 'rgba(0,0,0,0.8)';
  ctx.fillRect(x, y, w, lines.length * 18 + 8);
  ctx.fillStyle = color;
  lines.forEach((l, i) => ctx.fillText(l, x + 7, y + 18 + i * 18));
}
const bindingColor = (w: number) => `hsl(${120 * (1 - Math.max(0, Math.min(1, w)))}, 85%, 50%)`;

/** w şeritleri: üstte çözgü aralıkları (x eşlemesi sx), solda atkı aralıkları (y eşlemesi sy). */
function strips(
  ctx: SKRSContext2D,
  warp: AxisPositions,
  weft: AxisPositions,
  wGen: PositionGenerator,
  fGen: PositionGenerator,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  sx: (X: number) => number,
  sy: (Y: number) => number,
  top: number,
  left: number,
) {
  const rw = wGen.indexRange(x0, x1);
  const cw = wGen.centers(rw.first, rw.count + 1);
  for (let k = 0; k < rw.count; k++) {
    const g = rw.first + k;
    ctx.fillStyle = bindingColor(warp.binding[((g % warp.period) + warp.period) % warp.period]);
    ctx.fillRect(sx(cw[k]), top, sx(cw[k + 1]) - sx(cw[k]) - 1, STRIP);
  }
  const rf = fGen.indexRange(y0, y1);
  const cf = fGen.centers(rf.first, rf.count + 1);
  for (let k = 0; k < rf.count; k++) {
    const g = rf.first + k;
    ctx.fillStyle = bindingColor(weft.binding[((g % weft.period) + weft.period) % weft.period]);
    ctx.fillRect(left, sy(cf[k + 1]), STRIP, sy(cf[k]) - sy(cf[k + 1]) - 1);
  }
}

mkdirSync(OUT, { recursive: true });
const N = Math.trunc(VIEW_MM * PPM);
const BAND = DENT_BAND + LINK_BAND;
const all: Record<string, unknown> = {};
for (const [id, title, spec0] of sets) {
  const cells: Array<{ ws: number; fs: number; img: Canvas }> = [];
  const colorOf = (g: number) => spec0.warpSlots[slotOf(spec0.warpSequence, g, spec0.warpSlots.length)].color;
  for (const ws of WARP_SHRINK) {
    for (const fs of WEFT_SHRINK) {
      const spec = { ...spec0, warpShrinkPct: ws, weftShrinkPct: fs };
      const loomSpec = { ...spec0 };
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

      // Tuval: [Tezgah N] 16 [atkı bandı LEFT | Mamul N]
      const c = createCanvas(N + 16 + LEFT + N, BAND + N);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#090a0d';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(N, 0, 16, c.height);
      // Tezgah
      put(ctx, loom.image, 0, BAND);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, N, BAND);
      ctx.clip();
      drawReedStrip(ctx as unknown as StripContext, { reed, colorOf }, N, PPM, 0, 0);
      ctx.restore();
      const lsx = (X: number) => X * PPM;
      const lsy = (Y: number) => BAND + N - Y * PPM;
      strips(ctx, pos.warp, pos.weft, pos.warp.loom, pos.weft.loom, 0, VIEW_MM, 0, VIEW_MM, lsx, lsy, BAND, 0);
      // Mamul: dikeyde ortalı
      const mx = N + 16 + LEFT;
      const finH = fin.image.height;
      const finTop = BAND + Math.round((N - finH) / 2);
      put(ctx, fin.image, mx, finTop);
      const msx = (X: number) => mx + (X - fx0) * PPM;
      const msy = (Y: number) => finTop + finH - (Y - fy0) * PPM;
      ctx.save();
      ctx.translate(mx, 0);
      ctx.beginPath();
      ctx.rect(0, 0, N, BAND);
      ctx.clip();
      drawReedStrip(ctx as unknown as StripContext, { reed, colorOf, finished: pos.warp.finished, loomOriginX: 0 }, N, PPM, 0, fx0);
      ctx.restore();
      // Atkı bağlantı çizgileri: tezgah y (sol panelle aynı yükseklik eşlemesi) → mamul y
      ctx.fillStyle = '#d6dade';
      ctx.fillRect(N + 16, BAND, LEFT, N);
      ctx.strokeStyle = 'rgba(35,39,45,0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const r = pos.weft.loom.indexRange(0, VIEW_MM);
      const lc = pos.weft.loom.centers(r.first, r.count);
      const fcn = pos.weft.finished.centers(r.first, r.count);
      for (let k = 0; k < r.count; k++) {
        const ya = lsy(lc[k]);
        if (ya < BAND || ya > BAND + N) continue;
        ctx.moveTo(N + 16, ya);
        ctx.lineTo(N + 16 + LEFT, msy(fcn[k]));
      }
      ctx.stroke();
      strips(ctx, pos.warp, pos.weft, pos.warp.finished, pos.weft.finished, fx0, fx1, fy0, fy1, msx, msy, finTop, mx);
      // Ölçek ve etiketler
      ctx.fillStyle = 'rgb(240,240,240)';
      ctx.fillRect(12, BAND + N - 24, PPM, 6);
      ctx.fillRect(mx + 12, BAND + N - 24, PPM, 6);
      label(ctx, 10, BAND + 12, [`${title} — Tezgah`, `açıklık %${loom.openPct.toFixed(1)}`]);
      const boy = 100 * (1 - (fy1 - fy0) / VIEW_MM);
      const en = 100 * (1 - (fx1 - fx0) / VIEW_MM);
      label(ctx, mx + 10, BAND + 12, [
        `Mamul — çözgü çekmesi %${ws}, atkı çekmesi %${fs}`,
        `${m.Dw.toFixed(1)} tel/cm × ${m.Df.toFixed(1)} atkı/cm, açıklık %${fin.openPct.toFixed(1)}`,
        `gruplaşma oranı ç/a ${st.warp.groupingRatio.toFixed(2)} / ${st.weft.groupingRatio.toFixed(2)}`,
        `en büyük gözenek ${st.poreMm[0].toFixed(2)} × ${st.poreMm[1].toFixed(2)} mm`,
      ]);
      label(ctx, c.width - 250, BAND + N - 34, [`boy %${boy.toFixed(1)} kısaldı, en %${en.toFixed(1)} daraldı`], '#ffd666');
      writeFileSync(join(OUT, `${id}_c${String(ws).padStart(2, '0')}_a${String(fs).padStart(2, '0')}.png`), c.toBuffer('image/png'));
      cells.push({ ws, fs, img: c });

      all[`${id}_c${ws}_a${fs}`] = {
        title,
        warpShrinkPct: ws,
        weftShrinkPct: fs,
        weftBinding: Array.from(pos.weft.binding.slice(0, spec.weave.length)),
        weftGapsMm: Array.from(pos.weft.gaps),
        warpGroupingRatio: st.warp.groupingRatio,
        weftGroupingRatio: st.weft.groupingRatio,
        poreMm: st.poreMm,
        openPct: fin.openPct,
        Dw: m.Dw,
        Df: m.Df,
        feasible: st.feasible,
        warnings: st.warnings,
      };
      console.log(
        `${id.padEnd(17)} ç%${String(ws).padStart(2)} a%${String(fs).padStart(2)}  gruplaşma ç/a ${st.warp.groupingRatio.toFixed(2)}/${st.weft.groupingRatio.toFixed(2)}  ` +
          `gözenek ${st.poreMm[0].toFixed(2)}×${st.poreMm[1].toFixed(2)} mm  açıklık ${fin.openPct.toFixed(1)}` +
          (st.feasible ? '' : '  ULAŞILAMAZ'),
      );
    }
  }
  // Özet: 3 × 2 ızgara, yalnız mamul yarıları (küçültülmüş)
  const scale = 0.5;
  const cw = Math.round((LEFT + N) * scale);
  const ch = Math.round((BAND + N) * scale);
  const sum = createCanvas(cw * WEFT_SHRINK.length + 10, ch * WARP_SHRINK.length + 10 * WARP_SHRINK.length);
  const sctx = sum.getContext('2d');
  sctx.fillStyle = '#fff';
  sctx.fillRect(0, 0, sum.width, sum.height);
  cells.forEach((cell) => {
    const col = WEFT_SHRINK.indexOf(cell.fs);
    const row = WARP_SHRINK.indexOf(cell.ws);
    sctx.drawImage(cell.img as any, N + 16, 0, LEFT + N, BAND + N, col * (cw + 10), row * (ch + 10), cw, ch);
  });
  writeFileSync(join(OUT, `${id}_ozet.png`), sum.toBuffer('image/png'));
}
writeFileSync(join(OUT, 'metrics.json'), JSON.stringify(all, null, 2));
