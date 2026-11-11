/**
 * Tel bazlı çözgü (Durak 2) snapshot'ları: /dev/realistic-snapshots?phase=threading → samples/realistic/threading/
 *  - karisik-tahar.png: 8 çerçeve, tahar 1-3-5-7-2-4-6-8, 3/5 dimi armürü, F1–F4 = A (krem), F5–F8 = B (kiremit),
 *    tarak 2-1-0 (12 diş/cm), iplik dizisi 6; satırlar Lup 60 px/mm ve Göz 40 cm (25 px/mm), Tezgah; klasik | gerçekçi.
 *  - threading.json: düz tahar + eşdeğer matris ile piksel farkı (klasik ve gerçekçi; 0 olmalı), raporlar.
 */
import { assignSlotsByFrames, threadingTemplate, warpThreadRepeat, withThreading, withoutThreading } from '../../render-engine/threading';
import { physicalExample } from '../../presets/physicalExample';
import type { FabricSpec } from '../../render-engine/types';
import { classicCanvas, label, realisticCanvas, saveTo } from './reedFixSnapshots';

function mixedSpec(): FabricSpec {
  const base: FabricSpec = {
    ...physicalExample(0, 0),
    warpSlots: [
      { name: 'A', count: 300, system: 'Denier', color: '#e8e2d0', twist: 'S' },
      { name: 'B', count: 300, system: 'Denier', color: '#b5502f', twist: 'S' },
    ],
    weftSlots: [{ name: 'A', count: 300, system: 'Denier', color: '#1f2f5a', twist: 'S' }],
    warpSequence: [0, 0, 0, 0, 0, 0],
    weftSequence: [0],
    warpDensityLoom: 24,
    weftDensityLoom: 18,
    reed: { reedNumber: 12, dentingReport: [2, 1, 0] },
  } as FabricSpec;
  const threading = threadingTemplate('mixed', 8);
  const liftplan = Array.from({ length: 8 }, (_, j) => Array.from({ length: 8 }, (_, f) => (f - j + 8) % 8 < 3));
  const s = withThreading(base, threading, liftplan, 8);
  // İplik dizisi 6 (A A A A A B) üstüne çerçeve ataması: F1–F4 = A, F5–F8 = B (tel bazında)
  return { ...s, warpSequence: assignSlotsByFrames(threading, [0, 0, 0, 0, 0, 1], [
    { from: 0, to: 3, slot: 0 },
    { from: 4, to: 7, slot: 1 },
  ]) };
}

const diff = (a: HTMLCanvasElement, b: HTMLCanvasElement) => {
  const da = a.getContext('2d')!.getImageData(0, 0, a.width, a.height).data;
  const db = b.getContext('2d')!.getImageData(0, 0, b.width, b.height).data;
  let m = 0;
  for (let k = 0; k < da.length; k++) m = Math.max(m, Math.abs(da[k] - db[k]));
  return m;
};

export async function threadingSnapshots(say: (t: string) => void) {
  const spec = mixedSpec();
  const straight = withoutThreading(spec);
  const W = 560;
  const H = 300;
  const views: Array<[string, number, 'loupe' | 'eye']> = [
    ['Lup', 60, 'loupe'],
    ['Göz 40 cm', 25, 'eye'],
  ];
  const c = document.createElement('canvas');
  c.width = 2 * W + 8;
  c.height = views.length * (H + 4);
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  const diffs: Record<string, number> = {};
  for (let v = 0; v < views.length; v++) {
    const [vn, ppm, dist] = views[v];
    const top = v * (H + 4);
    const cl = classicCanvas(spec, W, H, ppm, 0.05, 1);
    const cl2 = classicCanvas(straight, W, H, ppm, 0.05, 1);
    const re = realisticCanvas(spec, 'loom', W, H, ppm, 0.05, 1, { distance: dist });
    re.renderer.dispose();
    const re2 = realisticCanvas(straight, 'loom', W, H, ppm, 0.05, 1, { distance: dist });
    re2.renderer.dispose();
    diffs[`klasik-${vn}`] = diff(cl, cl2);
    diffs[`gercekci-${vn}`] = diff(re.canvas, re2.canvas);
    g.drawImage(cl, 0, top);
    g.drawImage(re.canvas, W + 8, top);
    label(g, 6, top + 4, `Klasik · karışık tahar 1-3-5-7-2-4-6-8 · F1–F4 = A, F5–F8 = B · tarak 2-1-0 · ${ppm} px/mm`);
    label(g, W + 14, top + 4, `Gerçekçi · ${vn}`);
  }
  await saveTo('threading', 'karisik-tahar.png', c.toDataURL('image/png'), 'png');
  const report = {
    threading: spec.threading!.map((f) => f + 1),
    frames: spec.frames,
    warpSequence: spec.warpSequence,
    warpRepeat: warpThreadRepeat(spec),
    reed: spec.reed,
    maxPixelDiffVsStraightEquivalent: diffs,
    note: 'Düz tahar + eşdeğer örgü matrisi ile en büyük piksel farkı (0 = birebir aynı).',
  };
  await saveTo('threading', 'threading.json', JSON.stringify(report, null, 2), 'json');
  say(JSON.stringify(report));
  return report;
}
