import { describe, expect, it } from 'vitest';
import { DEFAULT_PACKING, packAxis, packedOpenPct, packKind, packSection, resolvePacking, type PackKind } from '../packing';
import { packedOpenPctOfSpec, specAxisTables } from '../adapters/positionsFromSpec';
import { fabricInputFromSpec } from '../adapters/fromSpec';
import { axisLayout } from '../layout';
import { tileFor } from '../tile';
import { parsePreset, serializePreset } from '../presets';
import { buildFabricPositions } from '../../render-engine/physical/shrinkDistribution';
import { computeMetrics, structureMetrics } from '../../render-engine/physical/metrics';
import { autoSupersample, simulatePhysical } from '../../render-engine/physical/simulate';
import { constantPhysicalRandom } from '../../render-engine/physical/random';
import { physicalExample } from '../../presets/physicalExample';
import { mockLeno3, plain } from '../../presets/weaves';
import type { FabricSpec } from '../../render-engine/types';

const P = DEFAULT_PACKING;

describe('paketleme: kesit', () => {
  it('hacim (kesit alanı) korunur: genişlik × yükseklik = d²', () => {
    for (const [d, cell] of [
      [0.2, 0.5],
      [0.2, 0.21],
      [0.3, 0.15],
    ]) {
      const s = packSection(d, cell, 'spunSingle', P);
      expect(s.width * s.height).toBeCloseTo(d * d, 12);
      expect(s.aspect).toBeCloseTo((s.width / d) ** 2, 12);
    }
  });
  it('genişlik hücreyi (doldurma oranıyla) ve tipin en/boy sınırını aşmaz; seyrek hücrede boşluk kalır', () => {
    const d = 0.2;
    const sparse = packSection(d, 1.0, 'filament', P);
    expect(sparse.width).toBeCloseTo(d * Math.sqrt(P.kinds.filament.maxAspect), 12);
    expect(sparse.width).toBeLessThan(1.0);
    const dense = packSection(d, 0.3, 'filament', P);
    expect(dense.width).toBeCloseTo(P.kinds.filament.fill * 0.3, 12);
    expect(dense.overlap).toBe(0);
  });
  it('sıkışma: hücre çaptan darsa genişlik en az compression·d, taşan kısım overlap', () => {
    const d = 0.2;
    const s = packSection(d, 0.1, 'spunPlied', P);
    expect(s.width).toBeCloseTo(P.compression * d, 12);
    expect(s.overlap).toBeCloseTo(P.compression * d - 0.1, 12);
    expect(s.height).toBeGreaterThan(d); // daralan kesit yükselir (alan korunur)
  });
  it('yayılma kapasitesi: filament > tekstüre > tek kat > çok kat (aynı hücrede)', () => {
    const w = (k: PackKind) => packSection(0.2, 0.6, k, P).width;
    expect(w('filament')).toBeGreaterThan(w('textured'));
    expect(w('textured')).toBeGreaterThan(w('spunSingle'));
    expect(w('spunSingle')).toBeGreaterThan(w('spunPlied'));
  });
  it('spread 0 = sert yuvarlak kesit', () => {
    const s = packSection(0.2, 0.6, 'filament', P, 0);
    expect(s.width).toBeCloseTo(0.2, 12);
    expect(s.aspect).toBeCloseTo(1, 12);
  });
  it('tip eşlemesi ve parametre birleştirme', () => {
    expect(packKind(undefined, 1)).toBe('spunSingle');
    expect(packKind(undefined)).toBe('spunPlied');
    expect(packKind('filament')).toBe('filament');
    const r = resolvePacking({ kinds: { filament: { fill: 0.5 } }, compression: 0.9 });
    expect(r.kinds.filament).toEqual({ maxAspect: P.kinds.filament.maxAspect, fill: 0.5 });
    expect(r.compression).toBe(0.9);
  });
});

describe('paketleme: eksen', () => {
  const uniform = (n: number, p: number) => Float64Array.from({ length: n }, (_, k) => (k + 0.5) * p);
  it('eşit aralıkta hücre = aralık; açık oran = (p − w)/p', () => {
    const lay = packAxis({ centers: uniform(4, 0.5), periodMm: 2, diameters: [0.2, 0.2, 0.2, 0.2], kinds: Array(4).fill('spunPlied') }, P);
    const w = lay.width[0];
    expect(lay.cellL[0] + lay.cellR[0]).toBeCloseTo(0.5, 12);
    expect(lay.clearFraction).toBeCloseTo((0.5 - w) / 0.5, 12);
  });
  it('boş diş sınırı: komşu hücre diş kenarında kesilir, boş diş şeridi açık kalır', () => {
    // 4-0 benzeri: 4 tel 1 mm'lik bir dişte, sonra 1 mm boş diş (periyot 2 mm)
    const c = [0.2, 0.4, 0.6, 0.8];
    const limitL = [0.2, Infinity, Infinity, Infinity];
    const limitR = [Infinity, Infinity, Infinity, 0.2];
    const lay = packAxis({ centers: c, periodMm: 2, diameters: [0.17, 0.17, 0.17, 0.17], kinds: Array(4).fill('spunPlied'), limitL, limitR }, P);
    expect(lay.cellR[3]).toBeCloseTo(0.2, 12);
    expect(lay.cellL[0]).toBeCloseTo(0.2, 12);
    // Dişler arası 1 mm (2 mm periyodun yarısı) açık sayılır
    expect(lay.clearFraction).toBeGreaterThan(0.5);
    // Kenardaki iplik dişin içine itilir (hücre içinde kalır)
    expect(lay.centers[3] + lay.width[3] / 2).toBeLessThanOrEqual(0.8 + 0.2 + 1e-12);
  });
  it('alan sınırı: hiçbir kesit (sıkışma dışında) hücresini aşmaz', () => {
    const c = [0.1, 0.35, 0.5, 0.9];
    const lay = packAxis({ centers: c, periodMm: 1.2, diameters: [0.2, 0.2, 0.2, 0.2], kinds: Array(4).fill('filament') }, P);
    for (let k = 0; k < 4; k++) {
      if (lay.overlap[k] > 0) continue;
      expect(lay.centers[k] - lay.width[k] / 2).toBeGreaterThanOrEqual(c[k] - lay.cellL[k] - 1e-12);
      expect(lay.centers[k] + lay.width[k] / 2).toBeLessThanOrEqual(c[k] + lay.cellR[k] + 1e-12);
    }
  });
  it('açıklık = çözgü açık oranı × atkı açık oranı', () => {
    const a = packAxis({ centers: uniform(2, 1), periodMm: 2, diameters: [0.2, 0.2], kinds: ['spunPlied', 'spunPlied'] }, P);
    expect(packedOpenPct(a, a)).toBeCloseTo(100 * a.clearFraction ** 2, 12);
  });
});

function demoSpec(over: Partial<FabricSpec> = {}): FabricSpec {
  return {
    version: 2,
    weave: plain(),
    warpSlots: [{ name: 'A', count: 30, system: 'Ne', color: '#dddddd', twist: 'Z' }],
    weftSlots: [{ name: 'A', count: 30, system: 'Ne', color: '#444444', twist: 'Z' }],
    warpSequence: [0],
    weftSequence: [0],
    warpDensityLoom: 20,
    weftDensityLoom: 20,
    warpShrinkPct: 0,
    weftShrinkPct: 0,
    warpCrimpShare: 0.4,
    ...over,
  } as FabricSpec;
}

describe('tarak: boş diş açıklığı (metrik)', () => {
  it('4-0 ve 2-2-3-0: paketlenmiş açıklık > 0 ve düz tarağa göre büyük', () => {
    const dense = demoSpec({ warpSlots: [{ name: 'A', count: 12, system: 'Ne', color: '#dddddd', twist: 'Z' }], warpDensityLoom: 40 });
    const flat = computeMetrics({ ...dense, reed: { reedNumber: 40, dentingReport: [1] } }).openPct;
    for (const rep of [[4, 0], [2, 2, 3, 0]]) {
      const avg = rep.reduce((a, b) => a + b, 0) / rep.length;
      const m = computeMetrics({ ...dense, reed: { reedNumber: 40 / avg, dentingReport: rep } });
      expect(m.openPct).toBeGreaterThan(0);
      expect(m.openPct).toBeGreaterThan(flat);
      expect(m.coverPacked).toBeCloseTo(100 - m.openPct, 12);
    }
  });
  it('yalancı lino + tarak 3-0: boş diş komşu hücreyi diş kenarında keser', () => {
    const spec = demoSpec({ weave: mockLeno3(), reed: { reedNumber: 10, dentingReport: [3, 0] } });
    const t = specAxisTables(spec, 'loom');
    expect(t.warp.limitLMm).toBeDefined();
    const finite = Array.from(t.warp.limitRMm!).filter((x) => Number.isFinite(x));
    expect(finite.length).toBeGreaterThan(0);
  });
  it('tarak yokken paketleme açıklığı, aynı konumlarda sert yuvarlak iplikten küçük ya da eşit', () => {
    const spec = demoSpec();
    const packed = packedOpenPctOfSpec(spec);
    const round = packedOpenPctOfSpec(spec, 'finished', undefined, {
      kinds: Object.fromEntries((['filament', 'textured', 'spunSingle', 'spunPlied', 'tape'] as PackKind[]).map((k) => [k, { maxAspect: 1, fill: 1 }])),
    });
    expect(packed).toBeLessThanOrEqual(round + 1e-9);
    // Sert yuvarlak iplik ile analitik konum açıklığı (racetrack, sıkışma yok) aynı mertebede
    expect(Math.abs(round - structureMetrics(spec).openPctAnalytic)).toBeLessThan(2);
  });
});

describe('gerçekçi motor: tarak konumları', () => {
  it('FabricInput.positions = buildFabricPositions konumları (g = i + 1), sıklık = periyottan', () => {
    const spec = demoSpec({ reed: { reedNumber: 10, dentingReport: [4, 0] } });
    const input = fabricInputFromSpec(spec);
    const pos = buildFabricPositions(spec);
    const P0 = pos.warp.period;
    const ref = pos.warp.loom.centers(1, P0);
    expect(input.positions?.warp?.centersMm.length).toBe(P0);
    for (let k = 0; k < P0; k++) expect(input.positions!.warp!.centersMm[k]).toBeCloseTo(ref[k], 5);
    expect(input.density.warpPerCm).toBeCloseTo(20, 9); // 10 diş/cm × ortalama 2 tel
    // Döşeme konum periyodunun katı; yerleşim kayması gerçek merkezi verir (hücre içine itme ≤ yarım hücre)
    const tile = tileFor(input);
    expect(tile.threads[0] % P0).toBe(0);
    const lay = axisLayout(input, 0, tile.threads[0]);
    const p = lay.pitch;
    for (let k = 0; k < P0; k++) expect(Math.abs((k + 0.5) * p + lay.offset[k] - ref[k])).toBeLessThan(0.5 * p);
  });
});

describe('klasik render: alan ortalaması', () => {
  it('düşük ölçekte (2 px/mm, ~52 tel/cm) S > 1; sık ölçekte S = 1', () => {
    const spec = { ...physicalExample(15, 22.5) };
    const low = { x0Mm: 0, y0Mm: 0, widthMm: 40, heightMm: 30, pxPerMm: 2 };
    const high = { x0Mm: 0, y0Mm: 0, widthMm: 8, heightMm: 8, pxPerMm: 110 };
    expect(autoSupersample(spec, low, buildFabricPositions(spec))).toBeGreaterThan(1);
    expect(autoSupersample(spec, high, buildFabricPositions(spec))).toBe(1);
  });
  it('moiré yok: satır / sütun ortalamaları referans alan ortalamasına (S = 8) yakın, tek örnek uzak', () => {
    const spec = { ...physicalExample(15, 22.5) };
    const view = { x0Mm: 0, y0Mm: 0, widthMm: 30, heightMm: 20, pxPerMm: 3 };
    const profile = (img: { width: number; height: number; data: Uint8ClampedArray | Uint8Array }) => {
      const rows = new Float64Array(img.height);
      const cols = new Float64Array(img.width);
      for (let y = 0; y < img.height; y++)
        for (let x = 0; x < img.width; x++) {
          const v = img.data[4 * (y * img.width + x)];
          rows[y] += v / img.width;
          cols[x] += v / img.height;
        }
      return [...rows, ...cols];
    };
    const err = (a: number[], b: number[]) => a.reduce((s, v, k) => s + Math.abs(v - b[k]), 0) / a.length;
    const opts = { random: constantPhysicalRandom(), scaleBar: false } as const;
    const ref = profile(simulatePhysical(spec, view, { ...opts, supersample: 8 }).image);
    const one = profile(simulatePhysical(spec, view, { ...opts, supersample: 1 }).image);
    const auto = profile(simulatePhysical(spec, view, opts).image);
    expect(err(auto, ref)).toBeLessThan(0.35 * err(one, ref));
  });
  it('S = 1 iken çıktı eski yol ile birebir (açık seçenek ile otomatik aynı)', () => {
    const spec = physicalExample(0, 0);
    const view = { x0Mm: 0, y0Mm: 0, widthMm: 3, heightMm: 3, pxPerMm: 60 };
    const opts = { random: constantPhysicalRandom(), scaleBar: false } as const;
    const a = simulatePhysical(spec, view, { ...opts, supersample: 1 });
    const b = simulatePhysical(spec, view, opts);
    expect(Buffer.from(b.image.data).equals(Buffer.from(a.image.data))).toBe(true);
  });
});

describe('preset: paketleme', () => {
  it('kaydet / yükle; eksik tip varsayılanla, sınır dışı değer hata', () => {
    const base = {
      version: 1 as const,
      name: 'x',
      yarn: { count: 20, unit: 'Ne' as const },
      surface: { luster: 'mat' as const, hairiness: 0.2 },
      light: { azimuthDeg: 135, elevationDeg: 45 },
      tuning: { aoStrength: 1, specularStrength: 1, specularWidth: 1, hairiness: 1, irregularity: 1 },
    };
    const packing = resolvePacking({ kinds: { spunSingle: { maxAspect: 2.2, fill: 0.9 } }, compression: 0.8 });
    const p = parsePreset(serializePreset({ ...base, packing }));
    expect(p.packing).toEqual(packing);
    const partial = parsePreset(JSON.stringify({ ...base, packing: { kinds: { filament: { fill: 0.7 } } } }));
    expect(partial.packing!.kinds.filament.fill).toBe(0.7);
    expect(partial.packing!.kinds.spunPlied).toEqual(DEFAULT_PACKING.kinds.spunPlied);
    expect(() => parsePreset(JSON.stringify({ ...base, packing: { compression: 2 } }))).toThrow(/compression/);
    expect(parsePreset(JSON.stringify(base)).packing).toBeUndefined();
  });
});
