/**
 * TS motoruyla referanstaki 5 örgüyü aynı parametrelerle render eder.
 *
 *   npm run samples            → samples/ts/out_*.png (seed'li gürültüyle)
 *   npm run samples -- flat <klasör>  → gürültüsüz (referans harness'ıyla piksel karşılaştırma için)
 *
 * Node'da çalışır: motorun DOM'a bağımlı olmadığının kanıtı. PNG kodlaması için @napi-rs/canvas.
 */
import { createCanvas } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  constantRandomSource,
  DEFAULT_PARAMS,
  renderHeightfield,
  type RgbaImage,
  type WeaveInput,
} from '../src/render-engine';
import { dobbyFancy, hopsack, plain, satin5, twill31 } from '../src/presets/weaves';

const T = '#3fc0d2';
const G = '#4a5058';
const jobs: Record<string, Omit<WeaveInput, 'nWarp' | 'nWeft'>> = {
  dobby: { weave: dobbyFancy(), warpColors: [T, G, T, G, G, T, G, T], weftColors: [G, T, G, G, T, G, T, T, G] },
  bezayagi: { weave: plain(), warpColors: [T, G], weftColors: [G, T] },
  dimi31: { weave: twill31(), warpColors: [T], weftColors: [G] },
  saten5: { weave: satin5(), warpColors: ['#8e2b3a'], weftColors: ['#d9cdb4'] },
  panama: {
    weave: hopsack(),
    warpColors: ['#1f3a6b', '#1f3a6b', '#c9a24a', '#c9a24a'],
    weftColors: ['#c9a24a', '#c9a24a', '#1f3a6b', '#1f3a6b'],
  },
};

function savePng(img: RgbaImage, path: string): void {
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  const id = ctx.createImageData(img.width, img.height);
  id.data.set(img.data);
  ctx.putImageData(id, 0, 0);
  writeFileSync(path, canvas.toBuffer('image/png'));
}

const flat = process.argv[2] === 'flat';
const outDir = process.argv[3] ?? join('samples', 'ts');
mkdirSync(outDir, { recursive: true });
for (const [name, job] of Object.entries(jobs)) {
  const t0 = performance.now();
  const img = renderHeightfield(
    { ...job, nWarp: 28, nWeft: 28 },
    { ...DEFAULT_PARAMS },
    flat ? { random: constantRandomSource() } : {},
  );
  savePng(img, join(outDir, `out_${name}.png`));
  console.log('ok', name, `${img.width}x${img.height}`, `${Math.round(performance.now() - t0)} ms`);
}
