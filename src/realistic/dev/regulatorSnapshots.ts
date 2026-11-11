/**
 * Atkı regülatörü görsel kontrolü: /dev/realistic-snapshots?phase=regulator → samples/realistic/regulator/
 *  - klasik.png ve gercekci.png: 6×6 yalancı lino (sepet) örgüsü, tarak 4 diş/cm × 3 tel/diş (diş teli oranı 0.77:
 *    gösterim için dişin açıklığı 3 telin çapına yakın), atkı regülatörü N R R N R R, makine 4 diş/cm (grup adımı iki
 *    yönde de 2.5 mm). Tezgah, 60 px/mm. İki yönde sepet grupları ve aralarında açıklık beklenir.
 *  - regulator.json: iki yöndeki grup adımı (mm) ve açıklık %.
 */
import { buildFabricPositions } from '../../render-engine/physical/shrinkDistribution';
import { computeMetrics } from '../../render-engine/physical/metrics';
import type { FabricSpec } from '../../render-engine/types';
import { classicCanvas, label, realisticCanvas, saveTo } from './reedFixSnapshots';
import { reproSpec } from './reedFixSnapshots';

export async function regulatorSnapshots(say: (t: string) => void) {
  const spec: FabricSpec = {
    ...reproSpec(null),
    warpShrinkPct: 0,
    weftShrinkPct: 0,
    weftDensityLoom: 4,
    reed: { reedNumber: 4, dentingReport: [3], wireRatio: 0.77 },
    weftRegulator: ['N', 'R', 'R', 'N', 'R', 'R'],
  };
  const ppm = 60;
  const W = 600;
  const H = 480;
  const x0 = -1.2;
  const y0 = -1.2;
  const cl = classicCanvas(spec, W, H, ppm, x0, y0);
  const re = realisticCanvas(spec, 'loom', W, H, ppm, x0, y0, { distance: 'loupe' });
  re.renderer.dispose();
  for (const [name, cv, t] of [
    ['klasik', cl, 'Klasik · yalancı lino 6×6 · tarak 4 diş/cm × 3 tel · regülatör N R R N R R (makine 4)'],
    ['gercekci', re.canvas, 'Gerçekçi · aynı kumaş · Lup 60 px/mm'],
  ] as const) {
    const g = cv.getContext('2d')!;
    label(g, 6, 6, t);
    await saveTo('regulator', `${name}.png`, cv.toDataURL('image/png'), 'png');
  }
  const pos = buildFabricPositions(spec);
  const m = computeMetrics(spec);
  const report = {
    warpGroupPitchMm: pos.reed!.pitchMm,
    weftGroupPitchMm: pos.weftRegulator!.pitchMm,
    effectiveWeftDensity: pos.weftLoomDensity,
    openPct: m.openPct,
    openTheoretical: m.openTheoretical,
    warnings: pos.warnings,
  };
  await saveTo('regulator', 'regulator.json', JSON.stringify(report, null, 2), 'json');
  say(JSON.stringify(report));
  return report;
}
