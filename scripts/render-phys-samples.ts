/**
 * TS fiziksel motoruyla referansın __main__ örneğini (3 çekme durumu) render eder ve metrikleri yazar.
 *
 *   npm run samples:phys                    → samples/ts/phys_*.png + phys_metrics.json (seed'li)
 *   npm run samples:phys -- flat <klasör>   → gürültüsüz (scripts/phys_harness.py flat ile karşılaştırma)
 */
import { createCanvas } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeMetrics, constantPhysicalRandom, simulatePhysical, type RgbaImage } from '../src/render-engine';
import { PHYSICAL_CASES, physicalExample } from '../src/presets/physicalExample';

function savePng(img: RgbaImage, path: string, label?: string[]): void {
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  const id = ctx.createImageData(img.width, img.height);
  id.data.set(img.data);
  ctx.putImageData(id, 0, 0);
  ctx.fillStyle = 'rgb(240,240,240)';
  ctx.font = '15px sans-serif';
  ctx.fillText('1 mm', 12, img.height - 34);
  if (label) {
    ctx.fillStyle = '#000';
    ctx.fillRect(8, 8, 462, 90);
    ctx.fillStyle = 'rgb(235,235,235)';
    label.forEach((t, k) => ctx.fillText(t, 14, 26 + k * 20));
  }
  writeFileSync(path, canvas.toBuffer('image/png'));
}

const flat = process.argv[2] === 'flat';
const outDir = process.argv[3] ?? join('samples', 'ts');
mkdirSync(outDir, { recursive: true });
const all: Record<string, Record<string, number | boolean>> = {};
for (const [name, sc, sa] of PHYSICAL_CASES) {
  const spec = physicalExample(sc, sa);
  const t0 = performance.now();
  const res = simulatePhysical(
    spec,
    { x0Mm: 0, y0Mm: 0, widthMm: 8, heightMm: 8, pxPerMm: 110 },
    flat ? { random: constantPhysicalRandom() } : { seed: 3 },
  );
  const m = computeMetrics(spec, { warpSlotsUsed: res.warpSlotsUsed, weftSlotsUsed: res.weftSlotsUsed });
  all[name] = {
    Dw: m.Dw,
    Df: m.Df,
    open_pct: res.openPct,
    cover: m.cover,
    jam_w: m.jamWarp,
    jam_f: m.jamWeft,
    crimp_w: m.crimpWarp,
    crimp_f: m.crimpWeft,
    gsm: m.gsm,
    jammed: res.jammedWarp || res.jammedWeft,
  };
  const label = flat
    ? undefined
    : [
        `${name}  çözgü çekmesi %${sc}  atkı çekmesi %${sa}`,
        `çözgü ${m.Dw.toFixed(1)} tel/cm  atkı ${m.Df.toFixed(1)} atkı/cm`,
        `açıklık %${res.openPct.toFixed(1)}  örtme %${m.cover.toFixed(0)}  ~${m.gsm.toFixed(0)} g/m²`,
        `sıkışma: çözgü %${m.jamWarp.toFixed(0)}  atkı %${m.jamWeft.toFixed(0)}`,
      ];
  savePng(res.image, join(outDir, `phys_${name}.png`), flat ? undefined : label);
  console.log('ok', name, `${Math.round(performance.now() - t0)} ms`);
}
writeFileSync(join(outDir, 'phys_metrics.json'), JSON.stringify(all, null, 2));
