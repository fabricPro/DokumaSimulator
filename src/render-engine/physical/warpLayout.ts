/**
 * Tek konum kaynağı: tel başına mm konumu, diş indeksi ve tarak duvarları (tezgah ya da mamul).
 *
 * Klasik render (simulate.ts → AxisPositions.*), gerçekçi render (realistic/adapters/positionsFromSpec →
 * FabricInput.positions), metrikler (paketleme açıklığı) ve diş cetveli (reedStrip: aynı ReedPositionGenerator)
 * buradaki tabloyu kullanır. Tel indeksi g, klasik render'ın global indeksidir (örgü sütunu g mod genişlik).
 *
 * Tarak telleri DUVARDIR: tezgahta bir dişin telleri o dişin iç açıklığında [openLeft, openRight] kalır. Mamulde
 * (çekme sonrası) duvar, tel merkezinden o yandaki komşu aralığının çekme oranıyla (g_mamul / g_tezgah) ölçeklenir:
 * gruplar orantılı yaklaşır, sıra ve grup yapısı korunur, boş diş yerinde boyuna açıklık kalır.
 * VARSAYIM: mamulde duvar payı yandaki aralıkla aynı oranda daralır (lif gevşemesi ayrıca modellenmez).
 */
import type { FabricSpec } from '../types';
import { buildFabricPositions, type AxisPositions, type FabricPositions } from './shrinkDistribution';

export interface AxisThreadLayout {
  /** Periyottaki tel sayısı ve periyot uzunluğu (mm). */
  period: number;
  periodMm: number;
  /** İlk telin global indeksi (tablo g = first .. first + period − 1). */
  first: number;
  centers: Float64Array;
  /** Diş indeksi (yalnız çözgü ve tarak varsa). */
  dent?: Int32Array;
  /** Merkezden sol / sağ duvara uzaklık (mm; yalnız tarak varsa). */
  wallL?: Float64Array;
  wallR?: Float64Array;
}

/** Diş kaynağı: tarak (çözgü) ya da atkı regülatörü (atkı). dentAt: dişin sınırları (mm). */
export interface DentSource {
  dentOf(g: number): number;
  dentAt(d: number): { left: number; right: number };
}

function axisLayout(ax: AxisPositions, which: 'loom' | 'finished', first: number, reed?: DentSource): AxisThreadLayout {
  const P = ax.period;
  const gen = ax[which];
  const c = gen.centers(first - 1, P + 3); // g = first − 1 .. first + P + 1
  const centers = c.slice(1, P + 1);
  const out: AxisThreadLayout = { period: P, periodMm: c[P + 1] - c[1], first, centers };
  if (!reed) return out;
  const loom = ax.loom.centers(first - 1, P + 3);
  const dent = new Int32Array(P);
  const wallL = new Float64Array(P);
  const wallR = new Float64Array(P);
  for (let k = 0; k < P; k++) {
    const g = first + k;
    const a = k + 1;
    dent[k] = reed.dentOf(g);
    const geo = reed.dentAt(dent[k]);
    // Tezgahta merkezden dişin sınırlarına (diş teli ortası). Merkezler zaten iç açıklıkta (ReedPositionGenerator;
    // sığmayan dişte açıklığa sıkıştırılır); kesit diş teline kadar yayılabilir ama komşu dişe / boş dişe geçemez.
    // VARSAYIM: duvar = diş sınırı (iç açıklık değil) — dolu komşu dişler arasında tel kalınlığı kadar boşluk
    // bırakılmaz (dokuma sonrası kumaşta diş telinin izi kapanır).
    const dl = Math.max(0, loom[a] - geo.left);
    const dr = Math.max(0, geo.right - loom[a]);
    const sl = which === 'finished' ? (c[a] - c[a - 1]) / (loom[a] - loom[a - 1]) : 1;
    const sr = which === 'finished' ? (c[a + 1] - c[a]) / (loom[a + 1] - loom[a]) : 1;
    wallL[k] = dl * sl;
    wallR[k] = dr * sr;
  }
  return { ...out, dent, wallL, wallR };
}

/** Çözgü ve atkı için tel tablosu (g = first ..). first = 1: gerçekçi modun i = 0 telinin klasik karşılığı. */
export function threadLayout(
  spec: FabricSpec,
  which: 'loom' | 'finished',
  positions: FabricPositions = buildFabricPositions(spec),
  first = 0,
): { warp: AxisThreadLayout; weft: AxisThreadLayout } {
  return {
    warp: axisLayout(positions.warp, which, first, positions.reed),
    weft: axisLayout(positions.weft, which, first, positions.weftRegulator),
  };
}
