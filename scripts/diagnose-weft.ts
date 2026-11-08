/**
 * Atkı gruplaşması teşhisi: yay modelinin atkı yönünde çalışıp çalışmadığını, w ve m değerlerini ve
 * konumların render'a aktarılıp aktarılmadığını kanıtlar.
 *
 *   npm run diagnose:weft
 *
 * Render kanıtı: mamul görüntüde her piksel satırının atkı mı (çözgüden farklı renk) yoksa
 * çözgü/boşluk mu olduğu, atkı kesitlerinin orta noktaları bulunarak ölçülür; yay modeli konumlarıyla
 * karşılaştırılır. Bunun için atkı rengi çözgüden ayrılabilir, gürültü sabit seçilir.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildFabricPositions,
  constantPhysicalRandom,
  simulatePhysical,
  slotTable,
  structureMetrics,
  warpGapBinding,
  weftGapBinding,
  type FabricSpec,
} from '../src/render-engine';
import { parseFabricJson } from '../src/importers/fabricJson';
import { hopsack, mockLeno3, twill31 } from '../src/presets/weaves';

const USER_FILE = join('samples', 'input', 'kullanici-6x6.json');
const f3 = (a: ArrayLike<number>) => Array.from(a, (x) => x.toFixed(3)).join(' ');
const f2 = (a: ArrayLike<number>) => Array.from(a, (x) => x.toFixed(2)).join(' ');

function base(weave: boolean[][]): FabricSpec {
  return {
    version: 2,
    weave,
    warpSlots: [{ name: 'A', count: 300, system: 'Denier', color: '#ffffff', twist: 'S' }],
    weftSlots: [{ name: 'A', count: 300, system: 'Denier', color: '#ff0000', twist: 'S' }],
    warpSequence: [0],
    weftSequence: [0],
    warpDensityLoom: 12,
    weftDensityLoom: 12,
    warpShrinkPct: 30,
    weftShrinkPct: 0,
    warpCrimpShare: 0.4,
  };
}

const cases: Array<[string, FabricSpec]> = [];
if (!existsSync(USER_FILE)) {
  console.error(`HATA: ${USER_FILE} yok.`);
  process.exitCode = 1;
} else {
  const s = parseFabricJson(readFileSync(USER_FILE, 'utf-8')).spec;
  cases.push(['kullanici-6x6 (kendi ayarları)', { ...s, warpShrinkPct: 30, weftShrinkPct: 0 }]);
  cases.push(['kullanici-6x6 (tek iplik 300 den, taraksız)', { ...base(s.weave) }]);
}
cases.push(['panama', base(hopsack())], ['3x3 yalanci lino', base(mockLeno3())], ['3/1 dimi', base(twill31())]);

for (const [name, spec] of cases) {
  const pos = buildFabricPositions(spec);
  const st = structureMetrics(spec, pos);
  const wt = slotTable(spec.warpSlots);
  const ft = slotTable(spec.weftSlots);
  console.log(`\n=== ${name}  (çözgü çekmesi %${spec.warpShrinkPct}, atkı çekmesi %${spec.weftShrinkPct}) ===`);
  console.log(`(b) w_çözgü: ${f2(warpGapBinding(spec.weave))}`);
  console.log(`    w_atkı : ${f2(weftGapBinding(spec.weave))}`);
  console.log(`(a) atkı yay modeli çağrıldı: ${!pos.weft.identity}  (identity=${pos.weft.identity}, feasible=${pos.weft.feasible})`);
  console.log(`    atkı tezgah aralıkları: ${f3(pos.weft.loomGaps)}`);
  console.log(`    atkı mamul aralıkları : ${f3(pos.weft.gaps)}`);
  const ftDiam = Array.from(ft.diameter);
  const wtDiam = Array.from(wt.diameter);
  console.log(`(c) m_j: ${f3(pos.weft.minGaps)}   (atkı çapları ${f3(ftDiam)} mm, karşı yön = çözgü çapları ${f3(wtDiam)} mm)`);
  const g = Array.from(pos.weft.gaps);
  console.log(
    `    gruplaşma oranı (en büyük/en küçük aralık): atkı ${(Math.max(...g) / Math.min(...g)).toFixed(2)}, ` +
      `çözgü ${(Math.max(...pos.warp.gaps) / Math.min(...pos.warp.gaps)).toFixed(2)}`,
  );
  console.log(
    `(d) metrik: atkı grup genişliği ${st.weft.meanGroupWidthMm.toFixed(3)} mm (yalnız değen iplikler), ` +
      `en büyük atkı gözeneği ${st.poreMm[1].toFixed(3)} mm`,
  );

  // Render kanıtı: tek iplikli kontrollü kopya (çözgü beyaz, atkı kırmızı)
  const probe: FabricSpec = {
    ...spec,
    reed: undefined,
    warpSlots: [{ ...spec.warpSlots[0], color: '#ffffff' }],
    warpSequence: [0],
    weftSlots: spec.weftSlots.map((s) => ({ ...s, color: '#ff0000' })),
  };
  const ppos = buildFabricPositions(probe);
  const ppm = 60;
  const fin = ppos.weft.finished;
  const H = 6; // mm
  const res = simulatePhysical(probe, { x0Mm: 0, y0Mm: 0, widthMm: 6, heightMm: H, pxPerMm: ppm }, { random: constantPhysicalRandom(), scaleBar: false, positions: ppos });
  const { width: W, height: Hp, data } = res.image;
  // Satırın atkı oranı: kırmızı baskın piksellerin oranı
  const redRow = new Float64Array(Hp);
  for (let y = 0; y < Hp; y++) {
    let n = 0;
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      if (data[o] > 60 && data[o] > data[o + 1] * 1.6) n++;
    }
    redRow[y] = n / W;
  }
  // Atkı kesitleri: kırmızı oranı eşiği aşan ardışık satır blokları → orta nokta (mm, alttan)
  const centersRender: number[] = [];
  let y = 0;
  while (y < Hp) {
    if (redRow[y] > 0.25) {
      const s0 = y;
      while (y < Hp && redRow[y] > 0.25) y++;
      const mid = (s0 + y - 1) / 2;
      centersRender.push((Hp - 1 - mid) / ppm);
    } else y++;
  }
  centersRender.sort((a, b) => a - b);
  const r = fin.indexRange(0, H);
  const model = Array.from(fin.centers(r.first, r.count)).filter((c) => c > 0.15 && c < H - 0.15);
  const inner = centersRender.filter((c) => c > 0.15 && c < H - 0.15);
  let maxErr = 0;
  for (const c of inner) {
    const nearest = model.reduce((b, m) => (Math.abs(m - c) < Math.abs(b - c) ? m : b), model[0]);
    maxErr = Math.max(maxErr, Math.abs(nearest - c));
  }
  console.log(
    `    render: ${inner.length} atkı kesiti bulundu, yay modeli merkezlerine en büyük sapma ${(maxErr * ppm).toFixed(1)} px ` +
      `(${maxErr.toFixed(3)} mm). Render aralıkları: ${f3(inner.slice(1).map((c, i) => c - inner[i]))}`,
  );
}
