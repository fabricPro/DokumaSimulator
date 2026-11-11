import { describe, expect, it } from 'vitest';
import { WeftRegulatorGenerator, activeRegulator, parseRegulator, regulatorEffectiveDensity, regulatorStats, type RegulatorToken } from '../regulator';
import { buildFabricPositions } from '../../physical/shrinkDistribution';
import { computeMetrics, effectiveLoomWeftDensity, structureMetrics } from '../../physical/metrics';
import { simulatePhysical } from '../../physical/simulate';
import { constantPhysicalRandom } from '../../physical/random';
import { parseFabricJson, serializeFabricJson } from '../../../importers/fabricJson';
import { physicalExample } from '../../../presets/physicalExample';
import { mockLeno3, plain } from '../../../presets/weaves';
import { fabricInputFromSpec } from '../../../realistic/adapters/fromSpec';
import { tileFor } from '../../../realistic/tile';
import { threadTable } from '../../../realistic/pack';
import { pitchMm } from '../../../realistic/scale';
import { threadLayout } from '../../physical/warpLayout';
import type { FabricSpec } from '../../types';

const NRR: RegulatorToken[] = ['N', 'R', 'R', 'N', 'R', 'R'];

function spec(over: Partial<FabricSpec> = {}): FabricSpec {
  return {
    version: 2,
    weave: plain(),
    warpSlots: [{ name: 'A', count: 300, system: 'Denier', color: '#dddddd', twist: 'S' }],
    weftSlots: [{ name: 'A', count: 300, system: 'Denier', color: '#444444', twist: 'S' }],
    warpSequence: [0],
    weftSequence: [0],
    warpDensityLoom: 12,
    weftDensityLoom: 4,
    warpShrinkPct: 0,
    weftShrinkPct: 0,
    warpCrimpShare: 0.4,
    ...over,
  } as FabricSpec;
}

describe('regülatör raporu', () => {
  it('ayrıştırma: N R R, NRR, N-R-R, S = PID; hatalı karakter', () => {
    expect(parseRegulator('N R R N R R')).toEqual({ ok: true, report: NRR });
    expect(parseRegulator('nrrnrr')).toEqual({ ok: true, report: NRR });
    expect(parseRegulator('N-S-S')).toEqual({ ok: true, report: ['N', 'R', 'R'] });
    expect(parseRegulator('N X').ok).toBe(false);
    expect(parseRegulator('  ').ok).toBe(false);
  });
  it('istatistik: L, R, N, etkin / makine oranı', () => {
    const s = regulatorStats(NRR);
    expect(s).toMatchObject({ L: 6, R: 4, N: 2, valid: true, ratio: 3 });
    expect(regulatorEffectiveDensity(4, NRR)).toBe(12);
    expect(regulatorStats(['R', 'R']).valid).toBe(false);
    expect(activeRegulator(['R', 'R'])).toBeUndefined();
  });
});

describe('regülatör konumları', () => {
  it('2) N R R N R R, makine 4 → etkin 12; atkı 1-2-3 aynı dişte, 4-5-6 sonraki dişte; diş aralığı 2.5 mm', () => {
    const sp = spec({ weftRegulator: NRR });
    expect(effectiveLoomWeftDensity(sp)).toBe(12);
    const pos = buildFabricPositions(sp);
    const reg = pos.weftRegulator!;
    expect(reg.pitchMm).toBeCloseTo(2.5, 12);
    expect(pos.weftLoomDensity).toBeCloseTo(12, 9);
    // atkı g = 0..5 (1..6. atkı)
    expect([0, 1, 2, 3, 4, 5].map((g) => reg.dentOf(g))).toEqual([0, 0, 0, 1, 1, 1]);
    const c = pos.weft.loom.centers(0, 6);
    // dişin merkezi j·p − p/2; dişteki atkılar temasla (merkezler arası = çap) ve diş merkezine ortalı
    const d = 0.0357 * Math.sqrt(33.33 / 0.85); // yaklaşık; asıl kontrol göreli
    void d;
    const gap = c[1] - c[0];
    expect(c[2] - c[1]).toBeCloseTo(gap, 9);
    expect(c[1]).toBeCloseTo(0 * 2.5 - 1.25, 9); // 1. dişin merkezi = ortadaki atkı
    expect(c[4]).toBeCloseTo(1 * 2.5 - 1.25, 9);
    expect(c[3] - c[0]).toBeCloseTo(2.5, 9); // dişten dişe (aynı konumdaki ilk atkılar)
    // dişler arası boşluk > dişteki atkılar arası boşluk (gruplama)
    expect(c[3] - c[2]).toBeGreaterThan(5 * gap);
    // diş geometrisi
    expect(reg.dentAt(0)).toMatchObject({ left: -2.5, right: 0, picks: 3 });
    expect(reg.dentAt(1)).toMatchObject({ left: 0, right: 2.5, picks: 3 });
  });
  it('3) rapor başı R → önceki tekrarın son dişine bağlanır (sarma)', () => {
    const rep: RegulatorToken[] = ['R', 'N', 'R', 'N'];
    const g = new WeftRegulatorGenerator(4, rep, () => 0.2, 1);
    // g = 0 (başta R): önceki tekrarın son dişi (−1); g = 1 yeni diş 0; g = 2 (R) diş 0; g = 3 diş 1; g = 4 (R) diş 1
    expect([0, 1, 2, 3, 4, 5].map((k) => g.dentOf(k))).toEqual([-1, 0, 0, 1, 1, 2]);
    const c = g.centers(0, 6);
    // g = 0 ile g = 4 aynı dişte: g = 4'ün periyot sonrası eşi
    expect(Math.abs(c[4] - c[3])).toBeCloseTo(0.2, 9); // g = 3 (diş 1) ile g = 4 (diş 1) temaslı
    // periyot sınırı: tekrar eden R'ler aynı diş (g = 3 ile g = 4 ve g = 4'ün sonraki periyot karşılığı g = 8)
    const c2 = g.centers(0, 12);
    expect(c2[8] - c2[3]).toBeGreaterThan(0); // artan konumlar
    for (let k = 1; k < 12; k++) expect(c2[k]).toBeGreaterThan(c2[k - 1]);
    expect(g.dentAt(-1).picks).toBe(2); // başta R + önceki tekrarın sonunda N + R (dişin üyeleri)
  });
  it('4) R R R R → geçersiz uyarısı, regülatör yok sayılır, çökme yok, konumlar regülatörsüzle aynı', () => {
    const base = buildFabricPositions(spec());
    const bad = buildFabricPositions(spec({ weftRegulator: ['R', 'R', 'R', 'R'] }));
    expect(bad.weftRegulator).toBeUndefined();
    expect(bad.warnings.join(' ')).toMatch(/Regülatör raporu geçersiz/);
    expect(Array.from(bad.weft.loom.centers(0, 8))).toEqual(Array.from(base.weft.loom.centers(0, 8)));
    expect(effectiveLoomWeftDensity(spec({ weftRegulator: ['R', 'R', 'R', 'R'] }))).toBe(4);
    expect(() => computeMetrics(spec({ weftRegulator: ['R', 'R'] }))).not.toThrow();
    expect(() => structureMetrics(spec({ weftRegulator: ['R'] }))).not.toThrow();
    expect(() => fabricInputFromSpec(spec({ weftRegulator: ['R', 'R'] }))).not.toThrow();
  });
  it('6) aşırı dolu diş → "Atkı sıkıştı" uyarısı; atkılar aralığa sığar', () => {
    // 3 atkı × 300 den (≈ 0.19 mm) ≈ 0.57 mm; makine 40 / cm → diş aralığı 0.25 mm
    const sp = spec({ weftDensityLoom: 40, weftRegulator: ['N', 'R', 'R'] });
    const pos = buildFabricPositions(sp);
    expect(pos.weftRegulator!.overfull.length).toBeGreaterThan(0);
    expect(pos.warnings.join(' ')).toMatch(/Atkı sıkıştı: regülatör grubu aralığa sığmıyor/);
    const c = pos.weft.loom.centers(0, 3);
    const dent = pos.weftRegulator!.dentAt(0);
    for (const x of c) {
      expect(x).toBeGreaterThanOrEqual(dent.left - 1e-9);
      expect(x).toBeLessThanOrEqual(dent.right + 1e-9);
    }
  });
  it('1) regülatör yok / hepsi N: konumlar, metrikler ve görüntü regülatörsüzle birebir', () => {
    const base = spec({ weave: mockLeno3(), weftDensityLoom: 15, warpShrinkPct: 6, weftShrinkPct: 10 });
    const allN = { ...base, weftRegulator: ['N', 'N', 'N'] as RegulatorToken[] };
    const a = buildFabricPositions(base);
    const b = buildFabricPositions(allN);
    const ca = Array.from(a.weft.finished.centers(0, 24));
    const cb = Array.from(b.weft.finished.centers(0, 24));
    ca.forEach((v, k) => expect(cb[k]).toBeCloseTo(v, 9));
    const ma = computeMetrics(base);
    const mb = computeMetrics(allN);
    expect(mb.Df).toBeCloseTo(ma.Df, 9);
    expect(mb.cover).toBeCloseTo(ma.cover, 9);
    expect(mb.openPct).toBeCloseTo(ma.openPct, 6);
    expect(mb.gsm).toBeCloseTo(ma.gsm, 6);
    // alan yokken görüntü: örnekler önceki sürümle aynı (samples:* git farkı ve düz referans ayrıca kontrol edilir)
    const view = { x0Mm: 0, y0Mm: 0, widthMm: 3, heightMm: 3, pxPerMm: 30 };
    const opts = { random: constantPhysicalRandom(), scaleBar: false } as const;
    const ia = simulatePhysical(base, view, opts);
    const ib = simulatePhysical({ ...base, weftRegulator: undefined }, view, opts);
    expect(Buffer.from(ia.image.data).equals(Buffer.from(ib.image.data))).toBe(true);
  });
});

describe('etkin sıklık ve metrikler', () => {
  it('mamul sıklık etkin sıklığa çekme uygulanarak; metrikler gerçek atkı konumlarından', () => {
    const sp = spec({ weftRegulator: NRR, weftShrinkPct: 0, warpShrinkPct: 10 });
    const m = computeMetrics(sp);
    expect(m.Df).toBeCloseTo(12 / (1 - 0.1), 6);
    // gruplar arası boşluk: regülatörsüz aynı etkin sıklıkla karşılaştır → daha açık (en büyük gözenek / açıklık)
    const uniform = computeMetrics(spec({ weftDensityLoom: 12, warpShrinkPct: 10 }));
    expect(m.openPct).toBeGreaterThan(uniform.openPct);
    const sm = structureMetrics(sp);
    const su = structureMetrics(spec({ weftDensityLoom: 12, warpShrinkPct: 10 }));
    expect(sm.poreMm[1]).toBeGreaterThan(su.poreMm[1]);
  });
  it('regülatör ile atkı sıklık raporu birlikte: regülatör geçerli, rapor yok sayılır (uyarı)', () => {
    const pos = buildFabricPositions(spec({ weftRegulator: NRR, weftDensityReport: [1, 2] }));
    expect(pos.warnings.join(' ')).toMatch(/birlikte kullanılamaz/);
    expect(pos.weftLoomDensity).toBeCloseTo(12, 9);
  });
});

describe('gerçekçi mod: atkı dişi duvarları', () => {
  it('hiçbir atkı dişinin dışına çıkmaz (düzensizlik ×3); klasik ve gerçekçi atkı konum tablosu aynı', () => {
    for (const which of ['loom', 'finished'] as const) {
      const sp = spec({ weave: mockLeno3(), weftRegulator: NRR, weftShrinkPct: 6, warpShrinkPct: 10, weftDensityLoom: 4 });
      const input = fabricInputFromSpec(sp, undefined, { densities: which });
      const pos = buildFabricPositions(sp);
      const t = input.positions!.weft!;
      const ref = pos.weft[which].centers(1, t.centersMm.length);
      for (let k = 0; k < ref.length; k++) expect(t.centersMm[k]).toBeCloseTo(ref[k], 5);
      const tile = tileFor(input);
      const th = threadTable(input, tile.threads, 3);
      const lay = threadLayout(sp, which, pos, 1).weft;
      const p = pitchMm(input.density.weftPerCm);
      const P = lay.period;
      expect(tile.threads[1] % P).toBe(0);
      for (let k = 0; k < tile.threads[1]; k++) {
        const o = (th.width * 4 + k) * 4; // satır 4 = atkı, k = 0
        const center = (k + 0.5) * p + th.data[o + 1];
        const wob = 0.0433 * 3 * 1.2 * p * (Math.abs(th.data[(th.width * 5 + k) * 4 + 2]) + Math.abs(th.data[(th.width * 5 + k) * 4 + 3]));
        const q = Math.floor(k / P);
        const kk = k - q * P;
        const r = q * lay.periodMm + lay.centers[kk];
        expect(center - wob).toBeGreaterThanOrEqual(r - lay.wallL![kk] - 1e-9);
        expect(center + wob).toBeLessThanOrEqual(r + lay.wallR![kk] + 1e-9);
      }
    }
  });
});

describe('kayıt', () => {
  it('JSON gidiş-dönüş; alan yoksa regülatör yok (eski dosya)', () => {
    const sp = spec({ weftRegulator: NRR });
    const back = parseFabricJson(serializeFabricJson(sp)).spec;
    expect(back.weftRegulator).toEqual(NRR);
    const old = parseFabricJson(serializeFabricJson(physicalExample(0, 0))).spec;
    expect(old.weftRegulator).toBeUndefined();
    expect(() => parseFabricJson(JSON.stringify({ ...JSON.parse(serializeFabricJson(sp)), weftRegulator: ['N', 'Q'] }))).toThrow(/weftRegulator/);
  });
});
