/**
 * Çekme dağılımı örnekleri: "Aynı iplikler" modunda Tezgah | Mamul yan yana.
 * Her örgü için %0 / %8 / %15 çekme (çözgü ve atkı eşit). İplik 300 den, tezgah 13/13 tel/cm.
 *
 *   npm run samples:shrink
 *
 * Çıktı: samples/shrink/<örgü>_<çekme>.png, samples/shrink/<örgü>_ozet.png, samples/shrink/metrics.json
 * Kullanıcı örgüsü samples/input/kullanici-6x6.json'dan okunur; yoksa script hata verir.
 */
import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildFabricPositions,
  computeMetrics,
  mapLoomToFinished,
  simulatePhysical,
  structureMetrics,
  type FabricSpec,
  type RgbaImage,
} from '../src/render-engine';
import { parseFabricJson } from '../src/importers/fabricJson';
import { hopsack, mockLeno3, plain } from '../src/presets/weaves';

const OUT = join('samples', 'shrink');
const USER_FILE = join('samples', 'input', 'kullanici-6x6.json');
const VIEW_MM = 8;
const PPM = 80;
const SHRINKS = [0, 8, 15];

function base(weave: boolean[][], over: Partial<FabricSpec> = {}): FabricSpec {
  return {
    version: 2,
    weave,
    warpSlots: [{ name: 'A', count: 300, system: 'Denier', color: '#e8e6e1', twist: 'S' }],
    weftSlots: [{ name: 'A', count: 300, system: 'Denier', color: '#4a5058', twist: 'S' }],
    warpSequence: [0],
    weftSequence: [0],
    warpDensityLoom: 13,
    weftDensityLoom: 13,
    warpShrinkPct: 0,
    weftShrinkPct: 0,
    warpCrimpShare: 0.4,
    ...over,
  };
}

const sets: Array<[string, string, FabricSpec]> = [
  ['bezayagi', 'Bezayağı', base(plain())],
  ['panama', 'Panama 2/2', base(hopsack())],
  ['yalanci_lino_taraksiz', '3×3 yalancı lino, taraksız', base(mockLeno3())],
  ['yalanci_lino_tarakli', '3×3 yalancı lino, tarak 3-0-0', base(mockLeno3(), { reed: { reedNumber: 13, reedUnit: 'diş/cm', dentingReport: [3, 0, 0] } })],
];
if (!existsSync(USER_FILE)) {
  console.error(`HATA: ${USER_FILE} bulunamadı. Uygulamada "JSON dışa aktar" ile kaydedin; bu örnek atlanmaz.`);
  process.exitCode = 1;
} else {
  const p = parseFabricJson(readFileSync(USER_FILE, 'utf-8'));
  // Karşılaştırılabilirlik için kullanıcının kendi iplik ve sıklık ayarları korunur
  sets.push(['kullanici_6x6', 'Kullanıcı 6×6', { ...p.spec, warpShrinkPct: 0, weftShrinkPct: 0 }]);
}

function put(ctx: SKRSContext2D, img: RgbaImage, x: number, y: number) {
  const id = ctx.createImageData(img.width, img.height);
  id.data.set(img.data);
  ctx.putImageData(id, x, y);
}

function label(ctx: SKRSContext2D, x: number, y: number, lines: string[]) {
  ctx.font = '14px sans-serif';
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
  ctx.fillStyle = 'rgba(0,0,0,0.78)';
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
const allMetrics: Record<string, unknown> = {};
const N = Math.trunc(VIEW_MM * PPM);
for (const [id, title, spec0] of sets) {
  const summary = createCanvas(N * SHRINKS.length + 16 * (SHRINKS.length - 1), N + 40);
  const sctx = summary.getContext('2d');
  sctx.fillStyle = '#ffffff';
  sctx.fillRect(0, 0, summary.width, summary.height);
  SHRINKS.forEach((s, si) => {
    const spec = { ...spec0, warpShrinkPct: s, weftShrinkPct: s };
    const loomSpec = { ...spec0, warpShrinkPct: 0, weftShrinkPct: 0 };
    const pos = buildFabricPositions(spec);
    const loom = simulatePhysical(loomSpec, { x0Mm: 0, y0Mm: 0, widthMm: VIEW_MM, heightMm: VIEW_MM, pxPerMm: PPM }, { seed: 3, scaleBar: false });
    // Aynı iplikler: tezgah penceresi [0, VIEW] → mamul pencere
    const fx1 = mapLoomToFinished(pos.warp, VIEW_MM);
    const fy1 = mapLoomToFinished(pos.weft, VIEW_MM);
    const fx0 = mapLoomToFinished(pos.warp, 0);
    const fy0 = mapLoomToFinished(pos.weft, 0);
    const fin = simulatePhysical(spec, { x0Mm: fx0, y0Mm: fy0, widthMm: fx1 - fx0, heightMm: fy1 - fy0, pxPerMm: PPM }, { seed: 3, scaleBar: false, positions: pos });
    const m = computeMetrics(spec);
    const st = structureMetrics(spec, pos);

    const c = createCanvas(N * 2 + 16, N);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#090a0d';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(N, 0, 16, N);
    put(ctx, loom.image, 0, 0);
    put(ctx, fin.image, N + 16, N - fin.image.height); // sol alta hizalı
    scaleBar(ctx, 12, N - 24);
    scaleBar(ctx, N + 28, N - 24);
    label(ctx, 8, 8, [`${title} — Tezgah`, `${spec.warpDensityLoom} × ${spec.weftDensityLoom} tel/cm, açıklık %${loom.openPct.toFixed(1)}`]);
    label(ctx, N + 24, 8, [
      `Mamul (aynı iplikler) — çekme %${s} / %${s}`,
      `${m.Dw.toFixed(1)} × ${m.Df.toFixed(1)} tel/cm, açıklık %${fin.openPct.toFixed(1)}`,
      `en büyük gözenek ${st.poreMm[0].toFixed(2)} × ${st.poreMm[1].toFixed(2)} mm`,
      `grup genişliği ç/a ${st.warp.meanGroupWidthMm.toFixed(2)} / ${st.weft.meanGroupWidthMm.toFixed(2)} mm`,
      ...(st.feasible ? [] : [`ULAŞILAMAZ: maks çekme %${st.maxWeftShrinkPct.toFixed(1)} en / %${st.maxWarpShrinkPct.toFixed(1)} boy`]),
    ]);
    writeFileSync(join(OUT, `${id}_${String(s).padStart(2, '0')}.png`), c.toBuffer('image/png'));

    // Özet: mamul görüntüleri yan yana
    const ox = si * (N + 16);
    sctx.fillStyle = '#090a0d';
    sctx.fillRect(ox, 0, N, N);
    put(sctx, fin.image, ox, N - fin.image.height);
    sctx.fillStyle = '#111';
    sctx.font = '16px sans-serif';
    sctx.fillText(`${title} — çekme %${s}`, ox + 4, N + 26);

    allMetrics[`${id}_${s}`] = {
      title,
      shrinkPct: s,
      Dw: m.Dw,
      Df: m.Df,
      openPctLoom: loom.openPct,
      openPct: fin.openPct,
      openPctAnalytic: st.openPctAnalytic,
      poreMm: st.poreMm,
      groupWidthMm: [st.warp.meanGroupWidthMm, st.weft.meanGroupWidthMm],
      groups: [st.warp.groups, st.weft.groups],
      jamWarp: m.jamWarp,
      jamWeft: m.jamWeft,
      gsm: m.gsm,
      feasible: st.feasible,
      warnings: st.warnings,
    };
    console.log(
      `${id.padEnd(24)} %${String(s).padStart(2)}  açıklık ${loom.openPct.toFixed(1).padStart(5)} → ${fin.openPct.toFixed(1).padStart(5)}  ` +
        `gözenek ${st.poreMm[0].toFixed(2)}×${st.poreMm[1].toFixed(2)} mm  grup ${st.warp.meanGroupWidthMm.toFixed(2)}/${st.weft.meanGroupWidthMm.toFixed(2)} mm` +
        (st.feasible ? '' : '  ULAŞILAMAZ'),
    );
  });
  writeFileSync(join(OUT, `${id}_ozet.png`), summary.toBuffer('image/png'));
}
writeFileSync(join(OUT, 'metrics.json'), JSON.stringify(allMetrics, null, 2));
