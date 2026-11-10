import { describe, expect, it } from 'vitest';
import { dentPitchMm, fromDentsPerCm, toDentsPerCm } from '../units';
import { formatDenting, parseDenting } from '../parse';
import { deriveReed } from '../derive';
import { ReedPositionGenerator } from '../layout';
import { normalizeReedSpec, type ReedSpec } from '../types';
import { diameterMm, toTex } from '../../physical/yarnPhysics';
import { buildFabricPositions } from '../../physical/shrinkDistribution';
import { structureMetrics } from '../../physical/metrics';
import { hopsack, mockLeno3, plain } from '../../../presets/weaves';
import { parseFabricJson, serializeFabricJson } from '../../../importers/fabricJson';
import type { FabricSpec } from '../../types';

const d300 = diameterMm(toTex(300, 'Denier'));
const reed20 = (report: number[], extra: Partial<ReedSpec> = {}): ReedSpec => ({
  reedNumber: 20,
  reedUnit: 'diş/cm',
  dentingReport: report,
  ...extra,
});

describe('birim dönüşümü', () => {
  it('20 diş/cm = 200 diş/10cm = 50.8 diş/inç; adım 0.5 mm', () => {
    expect(toDentsPerCm(200, 'diş/10cm')).toBeCloseTo(20, 12);
    expect(toDentsPerCm(50.8, 'diş/inç')).toBeCloseTo(20, 12);
    expect(fromDentsPerCm(20, 'diş/inç')).toBeCloseTo(50.8, 12);
    expect(dentPitchMm(20)).toBeCloseTo(0.5, 12);
    expect(deriveReed({ reedNumber: 50.8, reedUnit: 'diş/inç', dentingReport: [1] }).pitchMm).toBeCloseTo(0.5, 12);
  });
});

describe('türetilen değerler', () => {
  it("20'lik + 3-0: 1.5 tel/diş, 30 tel/cm, rapor 1.0 mm", () => {
    const d = deriveReed(reed20([3, 0]));
    expect(d.avgEndsPerDent).toBe(1.5);
    expect(d.loomWarpDensity).toBeCloseTo(30, 12);
    expect(d.reportWidthMm).toBeCloseTo(1.0, 12);
    expect(d.openingMm).toBeCloseTo(0.5 * 0.7, 12);
  });
  it("20'lik + 2-2-3-0: 1.75 tel/diş, 35 tel/cm", () => {
    const d = deriveReed(reed20([2, 2, 3, 0]));
    expect(d.avgEndsPerDent).toBe(1.75);
    expect(d.loomWarpDensity).toBeCloseTo(35, 12);
  });
  it('tarak eni: toplam diş/tel, tam rapor, eksik rapor uyarısı', () => {
    const d = deriveReed(reed20([3, 0], { reedWidthCm: 10.05 })); // 201 diş
    expect(d.totals).toEqual({ dents: 201, ends: 303, fullRepeats: 100, partialDents: 1 });
    expect(d.warnings.join(' ')).toMatch(/eksik rapor/);
    expect(deriveReed(reed20([3, 0], { reedWidthCm: 10 })).warnings).toEqual([]);
  });
  it('girilen sıklık tutmazsa uyarı', () => {
    expect(deriveReed(reed20([3, 0]), 25).warnings.join(' ')).toMatch(/türetilen 30/);
    expect(deriveReed(reed20([3, 0]), 30).warnings).toEqual([]);
  });
});

describe('rapor sözdizimi', () => {
  const ok = (t: string) => {
    const r = parseDenting(t);
    if (!r.ok) throw new Error(r.error);
    return r.report;
  };
  it('örnekler', () => {
    expect(ok('3-0')).toEqual([3, 0]);
    expect(ok('3-3-3-0-0')).toEqual([3, 3, 3, 0, 0]);
    expect(ok('3x4, 0x2')).toEqual([3, 3, 3, 3, 0, 0]);
    expect(ok('(2-2-3)x2, 0')).toEqual([2, 2, 3, 2, 2, 3, 0]);
    expect(ok('((1-0)x2-3)x2')).toEqual([1, 0, 1, 0, 3, 1, 0, 1, 0, 3]);
    expect(ok('3×2, 0*2')).toEqual([3, 3, 0, 0]);
  });
  it('formatDenting gidiş-dönüş', () => {
    for (const r of [[3, 0], [3, 3, 3, 3, 0, 0], [2, 2, 3, 0], [1], [4, 0, 0, 0, 0]]) {
      expect(ok(formatDenting(r))).toEqual(r);
    }
    expect(formatDenting([3, 3, 3, 3, 0, 0])).toBe('3x4-0-0');
  });
  it('hatalı girişler Türkçe mesaj ve konumla reddedilir', () => {
    const err = (t: string) => {
      const r = parseDenting(t);
      if (r.ok) throw new Error('geçmemeliydi: ' + t);
      return r;
    };
    expect(err('').error).toMatch(/boş/);
    expect(err('3-a').error).toMatch(/tanınmayan/);
    expect(err('3-a').position).toBe(2);
    expect(err('(2-2').error).toMatch(/kapanmamış/);
    expect(err('2)').error).toMatch(/açılmamış/);
    expect(err('3x').error).toMatch(/tekrar sayısı eksik/);
    expect(err('3x0').error).toMatch(/en az 1/);
    expect(err('-3').error).toMatch(/negatif/);
    expect(err('3, -2').error).toMatch(/negatif/);
    expect(err('2.5').error).toMatch(/ondalıklı/);
    expect(err('0-0').error).toMatch(/en az bir dişte/);
    expect(err('3-0-').error).toMatch(/son değer eksik/);
    expect(err('3 3').error).toMatch(/ayırıcı bekleniyordu/);
    expect(err('x3').error).toMatch(/tekrar işaretinden önce/);
    expect(err('3x3000').error).toMatch(/2000/);
  });
});

describe('tezgah konumları', () => {
  it('aynı dişteki teller açıklık içinde, diş merkezine göre simetrik, n+1 eşit boşluk', () => {
    const g = new ReedPositionGenerator(reed20([3, 0]), () => 0.05, 1);
    const dent = g.dentAt(0);
    const c = g.centers(0, 3);
    for (const x of c) {
      expect(x).toBeGreaterThan(dent.openLeft);
      expect(x).toBeLessThan(dent.openRight);
    }
    expect((c[0] + c[2]) / 2).toBeCloseTo(dent.center, 12);
    const gap = (dent.openRight - dent.openLeft - 3 * 0.05) / 4;
    expect(c[0] - 0.025 - dent.openLeft).toBeCloseTo(gap, 12);
    expect(c[1] - c[0] - 0.05).toBeCloseTo(gap, 12);
  });
  it('boş diş komşu boşluğu ≈ bir adım + normal diş arası boşluk', () => {
    const plainReed = new ReedPositionGenerator(reed20([3]), () => 0.05, 1);
    const withEmpty = new ReedPositionGenerator(reed20([3, 0]), () => 0.05, 1);
    const normal = plainReed.centers(2, 2); // 0. dişin son teli → 1. dişin ilk teli
    const across = withEmpty.centers(2, 2); // 0. dişin son teli → 2. dişin ilk teli (1. diş boş)
    expect(across[1] - across[0]).toBeCloseTo(normal[1] - normal[0] + 0.5, 12);
  });
  it('çap toplamı açıklığı aşarsa teller diş açıklığına sıkışır (ortalanmış)', () => {
    const g = new ReedPositionGenerator(reed20([4]), () => 0.12, 1); // 0.48 > 0.35
    const c = g.centers(0, 4);
    // Paketleme turu (B2): teller diş açıklığına sıkışır — aralık açıklık / n, merkezler açıklığın içinde
    expect(c[1] - c[0]).toBeCloseTo(0.35 / 4, 12);
    expect((c[0] + c[3]) / 2).toBeCloseTo(g.dentAt(0).center, 12);
    const dent = g.dentAt(0);
    for (const x of c) {
      expect(x).toBeGreaterThan(dent.openLeft);
      expect(x).toBeLessThan(dent.openRight);
    }
  });
  it('startOffset raporu kaydırır', () => {
    const g = new ReedPositionGenerator(reed20([3, 0], { startOffset: 1 }), () => 0.05, 1);
    expect(g.dentAt(0).ends).toBe(0);
    expect(g.dentAt(1).ends).toBe(3);
    expect(g.dentOfWarp(0)).toBe(1);
  });
  it('sığmama uyarısı: 20\'lik tarakta 6 × 300 den tek dişe', () => {
    const g = new ReedPositionGenerator(reed20([6]), () => d300, 1);
    expect(g.overfull.length).toBeGreaterThan(0);
    expect(g.overfull[0]).toMatchObject({ dent: 0, ends: 6 });
    const p = buildFabricPositions(spec(plain(), { reed: reed20([6]) }));
    expect(p.warnings.join(' ')).toMatch(/1\. dişe 6 tel sığmıyor/);
    expect(new ReedPositionGenerator(reed20([2]), () => d300, 1).overfull).toEqual([]);
  });
  it('hiza: her çözgü merkezi kendi dişinin açıklığında (şerit ile aynı üretici)', () => {
    for (const report of [[3, 0], [2, 2, 3, 0], [1], [2], [4, 0, 0]]) {
      const g = new ReedPositionGenerator(reed20(report), () => 0.05, 2);
      for (let w = -20; w < 60; w++) {
        const dent = g.dentAt(g.dentOfWarp(w));
        const x = g.centers(w, 1)[0];
        expect(dent.ends).toBeGreaterThan(0);
        expect(x).toBeGreaterThan(dent.openLeft);
        expect(x).toBeLessThan(dent.openRight);
      }
    }
  });
});

function spec(weave: boolean[][], over: Partial<FabricSpec> = {}): FabricSpec {
  return {
    version: 2,
    weave,
    warpSlots: [{ name: 'A', count: 300, system: 'Denier', color: '#ddd', twist: 'S' }],
    weftSlots: [{ name: 'A', count: 300, system: 'Denier', color: '#444', twist: 'S' }],
    warpSequence: [0],
    weftSequence: [0],
    warpDensityLoom: 20,
    weftDensityLoom: 20,
    warpShrinkPct: 0,
    weftShrinkPct: 0,
    warpCrimpShare: 0.4,
    ...over,
  };
}

describe('tarak + çekme', () => {
  const at = (weave: boolean[][], report: number[], s: number) =>
    buildFabricPositions(spec(weave, { reed: reed20(report), warpShrinkPct: s, weftShrinkPct: s }));

  it("bezayağı + 2'li düz: her çekmede çözgü yönünde eşit aralık çiftleri (diş içi / diş arası) korunur, gruplaşma yok", () => {
    for (const s of [0, 8, 15]) {
      const g = Array.from(at(plain(), [2], s).warp.gaps);
      // Tarak 2'li: diş içi ve diş arası aralıklar dönüşümlü; w hepsi 1 olduğundan oran değişmez
      const ratio0 = Array.from(at(plain(), [2], 0).warp.gaps);
      expect(g[0] / g[1]).toBeCloseTo(ratio0[0] / ratio0[1], 6);
      for (let k = 2; k < g.length; k++) expect(g[k]).toBeCloseTo(g[k % 2], 10);
    }
  });
  it("panama + 2'li düz: ikili gruplaşma (çift içi < çiftler arası) ve çekmeyle artar", () => {
    // 300 denier ×2 bu dişe sığmaz (Σ çap 0.45 > açıklık 0.35 → paketleme turundan beri diş içine sıkışır, çift içi
    // aralık en küçük aralıkta kilitli); gruplaşma eğilimi dişe sığan 150 denier ile sınanır
    const thin: Partial<FabricSpec> = { warpSlots: [{ ...spec(hopsack(), {}).warpSlots[0], count: 150 }] };
    const at2 = (s: number) => buildFabricPositions(spec(hopsack(), { reed: reed20([2]), warpShrinkPct: s, weftShrinkPct: s, ...thin }));
    const g0 = at2(0).warp.gaps;
    const g15 = at2(15).warp.gaps;
    expect(g15[0]).toBeLessThan(g15[1]);
    expect(g15[0] / g15[1]).toBeLessThan(g0[0] / g0[1]);
  });
  it("yalancı lino + 3-0-0, 1'li düz tarağa göre daha büyük gözenek ve grup", () => {
    for (const s of [0, 8, 15]) {
      const leno = structureMetrics(spec(mockLeno3(), { reed: { reedNumber: 30, dentingReport: [3, 0, 0] }, warpShrinkPct: s, weftShrinkPct: s }));
      const one = structureMetrics(spec(mockLeno3(), { reed: { reedNumber: 30, dentingReport: [1] }, warpShrinkPct: s, weftShrinkPct: s }));
      expect(leno.poreMm[0]).toBeGreaterThan(one.poreMm[0] * 1.5);
      expect(leno.warp.meanGroupWidthMm).toBeGreaterThan(one.warp.meanGroupWidthMm);
    }
  });
});

describe('spec göçü', () => {
  it('eski { densityPerCm, denting } okunur', () => {
    expect(normalizeReedSpec({ densityPerCm: 13, denting: [3, 0, 0] })).toEqual({
      reedNumber: 13,
      reedUnit: 'diş/cm',
      dentingReport: [3, 0, 0],
    });
    const s = { ...spec(plain()), reed: { densityPerCm: 13, denting: [3, 0, 0] } };
    expect(parseFabricJson(JSON.stringify(s)).spec.reed).toEqual({ reedNumber: 13, reedUnit: 'diş/cm', dentingReport: [3, 0, 0] });
  });
  it('tarak içeren v2 JSON gidiş-dönüş; taraksız dosya taraksız açılır', () => {
    const s = spec(mockLeno3(), { reed: reed20([3, 0], { wireRatio: 0.25, reedWidthCm: 150, startOffset: 1 }) });
    expect(parseFabricJson(serializeFabricJson(s)).spec).toEqual(s);
    expect(parseFabricJson(serializeFabricJson(spec(plain()))).spec.reed).toBeUndefined();
    expect(() => parseFabricJson(JSON.stringify({ ...s, reed: reed20([0, 0]) }))).toThrow(/dentingReport/);
  });
});
