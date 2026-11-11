/**
 * Tarak kayması turu (Durak 1) snapshot'ları: /dev/realistic-snapshots?phase=reed-fix → samples/realistic/reed-fix/
 *  - <vaka>-<panel>.png: üstte diş cetveli (tezgah diş geometrisi), solda klasik heightfield, sağda gerçekçi;
 *    sıralar: Lup 180 px/mm, Göz 40 cm ve Uzak 2 m (aynı pencere, 25 px/mm). panel = tezgah | mamul.
 *  - reed-fix.json: gerçekçi G-buffer'da boş diş bölgesine düşen çözgü pikseli oranı (tezgah lup; 0 olmalı),
 *    gerçekçi çözgü pikseli bulunan diş sayısı ↔ dolu diş sayısı.
 */
import { createRealisticRenderer } from '../index';
import { simulatePhysical } from '../../render-engine/physical/simulate';
import { buildFabricPositions } from '../../render-engine/physical/shrinkDistribution';
import type { FabricSpec } from '../../render-engine/types';
import type { ViewParams } from '../types';
import { fabricInputFromSpec } from '../adapters/fromSpec';
import { mockLeno3 } from '../../presets/weaves';

const LIGHT = { azimuthDeg: 135, elevationDeg: 45 };

export async function saveTo(phase: string, name: string, body: string, kind: 'png' | 'json') {
  const res = await fetch('/__realistic/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phase, name, kind, data: body }),
  });
  if (!res.ok) throw new Error(`${name} kaydedilemedi: ${res.status} ${await res.text()}`);
}

export function label(ctx: CanvasRenderingContext2D, x: number, y: number, t: string) {
  ctx.font = '14px system-ui, sans-serif';
  const w = ctx.measureText(t).width + 12;
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.fillRect(x, y, w, 20);
  ctx.fillStyle = '#fff';
  ctx.fillText(t, x + 6, y + 14);
}

export function reproSpec(report: number[] | null): FabricSpec {
  return {
    version: 2,
    weave: mockLeno3(),
    warpSlots: [{ name: 'A', count: 300, system: 'Denier', color: '#e8e2d0', twist: 'S' }],
    weftSlots: [{ name: 'A', count: 300, system: 'Denier', color: '#1f2f5a', twist: 'S' }],
    warpSequence: [0],
    weftSequence: [0],
    warpDensityLoom: 12,
    weftDensityLoom: 15,
    warpShrinkPct: 6,
    weftShrinkPct: 10,
    warpCrimpShare: 0.4,
    ...(report ? { reed: { reedNumber: 12, dentingReport: report } } : {}),
  } as FabricSpec;
}

export function classicCanvas(spec: FabricSpec, w: number, h: number, ppm: number, x0: number, y0: number) {
  const res = simulatePhysical(spec, { x0Mm: x0, y0Mm: y0, widthMm: w / ppm, heightMm: h / ppm, pxPerMm: ppm }, { scaleBar: false });
  const c = document.createElement('canvas');
  c.width = res.image.width;
  c.height = res.image.height;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(res.image.data), res.image.width, res.image.height), 0, 0);
  return c;
}

export function realisticCanvas(spec: FabricSpec, which: 'loom' | 'finished', w: number, h: number, ppm: number, x0: number, y0: number, extra: Partial<ViewParams> = {}) {
  const input = fabricInputFromSpec(spec, undefined, { densities: which });
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const r = createRealisticRenderer(c, { preserveDrawingBuffer: true });
  r.render(input, { pxPerCm: ppm * 10, offsetCm: [x0 / 10, y0 / 10], light: LIGHT, quality: 'high', ...extra });
  const o = document.createElement('canvas');
  o.width = w;
  o.height = h;
  o.getContext('2d')!.drawImage(c, 0, 0);
  return { canvas: o, renderer: r, input };
}

/** Diş cetveli: diş telleri koyu, boş diş taralı (tezgah); mamulde diş sınırları aynı tellerin mamul konumuna eşlenir. */
function drawRuler(g: CanvasRenderingContext2D, spec: FabricSpec, which: 'loom' | 'finished', x: number, w: number, ppm: number, x0: number) {
  const pos = buildFabricPositions(spec);
  const reed = pos.reed;
  g.fillStyle = '#d6dade';
  g.fillRect(x, 0, w, 22);
  if (!reed) return;
  g.save();
  g.beginPath();
  g.rect(x, 0, w, 22);
  g.clip();
  drawDents(g, pos, reed, which, x, w, ppm, x0);
  g.restore();
}

function drawDents(
  g: CanvasRenderingContext2D,
  pos: ReturnType<typeof buildFabricPositions>,
  reed: NonNullable<ReturnType<typeof buildFabricPositions>['reed']>,
  which: 'loom' | 'finished',
  x: number,
  w: number,
  ppm: number,
  x0: number,
) {
  const map = (X: number) => {
    if (which === 'loom') return X;
    // diş sınırını, iki yanındaki çözgülerin tezgah → mamul eşlemesiyle taşı
    const lp = pos.warp.loom.meanPitchMm();
    let gi = Math.floor(X / lp) - 3;
    let c = pos.warp.loom.centers(gi, 8);
    while (c[0] > X) {
      gi -= 4;
      c = pos.warp.loom.centers(gi, 8);
    }
    let k = 0;
    while (k < 6 && c[k + 1] <= X) k++;
    const f = pos.warp.finished.centers(gi + k, 2);
    const t = (X - c[k]) / (c[k + 1] - c[k]);
    return f[0] + t * (f[1] - f[0]);
  };
  const dr = reed.dentRange(x0 - 2, x0 + w / ppm + 2);
  for (let j = dr.first - 2; j <= dr.last + 2; j++) {
    const d = reed.dentAt(j);
    const L = x + (map(d.left) - x0) * ppm;
    const OL = x + (map(d.openLeft) - x0) * ppm;
    const OR = x + (map(d.openRight) - x0) * ppm;
    const R = x + (map(d.right) - x0) * ppm;
    g.fillStyle = '#23272d';
    g.fillRect(L, 2, OL - L, 18);
    g.fillRect(OR, 2, R - OR, 18);
    if (d.ends === 0) {
      g.fillStyle = 'rgba(200,60,60,0.35)';
      g.fillRect(OL, 2, OR - OL, 18);
    } else {
      g.fillStyle = '#23272d';
      g.font = '11px system-ui';
      g.fillText(String(d.ends), (OL + OR) / 2 - 3, 15);
    }
  }
}

export async function reedFixSnapshots(say: (t: string) => void) {
  const cases: Array<[string, number[] | null]> = [
    ['3-0-0', [3, 0, 0]],
    ['4-0', [4, 0]],
    ['3-3-0', [3, 3, 0]],
    ['2-2-3-0', [2, 2, 3, 0]],
    ['tarak-yok', null],
  ];
  const W = 560;
  const HL = 300;
  const rows: Record<string, unknown>[] = [];
  for (const [name, rep] of cases) {
    const spec = reproSpec(rep);
    for (const which of ['loom', 'finished'] as const) {
      const panelSpec = which === 'loom' ? { ...spec, warpShrinkPct: 0, weftShrinkPct: 0 } : spec;
      const views: Array<[string, number, Partial<ViewParams>]> = [
        ['Lup', 180, { distance: 'loupe' }],
        ['Göz 40 cm', 25, { distance: 'eye' }],
        ['Uzak 2 m', 25, { distance: 'far' }],
      ];
      const c = document.createElement('canvas');
      c.width = 2 * W + 8;
      c.height = views.length * (HL + 26);
      const g = c.getContext('2d')!;
      g.fillStyle = '#000';
      g.fillRect(0, 0, c.width, c.height);
      let misplaced = 0;
      let warpPx = 0;
      for (let v = 0; v < views.length; v++) {
        const [vn, ppm, extra] = views[v];
        const x0 = 0.05;
        const y0 = 1;
        const top = v * (HL + 26);
        g.save();
        g.translate(0, top);
        drawRuler(g, panelSpec, which, 0, W, ppm, x0);
        drawRuler(g, panelSpec, which, W + 8, W, ppm, x0);
        g.drawImage(classicCanvas(panelSpec, W, HL, ppm, x0, y0), 0, 24);
        const re = realisticCanvas(panelSpec, which, W, HL, ppm, x0, y0, extra);
        g.drawImage(re.canvas, W + 8, 24);
        label(g, 6, 28, `Klasik · ${name} · ${which === 'loom' ? 'Tezgah' : 'Mamul'} · ${ppm} px/mm`);
        label(g, W + 14, 28, `Gerçekçi · ${vn}`);
        // Tezgah lupta: boş diş bölgesine düşen gerçekçi çözgü pikselleri
        if (v === 0 && which === 'loom' && rep) {
          const gb = re.renderer.readGBuffer();
          const reed = buildFabricPositions(panelSpec).reed!;
          for (let py = 0; py < HL; py++) {
            for (let px = 0; px < W; px++) {
              const k = (py * W + px) * 4;
              if (!(gb.gb1[k + 2] > 0.5 && gb.gb1[k + 2] < 1.5)) continue;
              warpPx++;
              const X = x0 + (px + 0.5) / ppm;
              const dr = reed.dentRange(X, X);
              const d = reed.dentAt(dr.first);
              if (d.ends === 0) misplaced++;
            }
          }
        }
        re.renderer.dispose();
        g.restore();
      }
      await saveTo('reed-fix', `${name}-${which === 'loom' ? 'tezgah' : 'mamul'}.png`, c.toDataURL('image/png'), 'png');
      const row = { case: name, panel: which, warpPixels: warpPx, warpPixelsInEmptyDent: misplaced, pct: warpPx ? +((100 * misplaced) / warpPx).toFixed(3) : 0 };
      rows.push(row);
      say(JSON.stringify(row));
    }
  }
  const report = {
    note: 'Lup 180 px/mm, Göz / Uzak 25 px/mm; aynı pencere (x0 0.05 mm, y0 1 mm). warpPixelsInEmptyDent: tezgah lupta boş diş sınırları içine düşen gerçekçi çözgü pikseli (0 olmalı).',
    rows,
  };
  await saveTo('reed-fix', 'reed-fix.json', JSON.stringify(report, null, 2), 'json');
  return report;
}
