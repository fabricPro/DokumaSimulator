import { describe, expect, it } from 'vitest';
import {
  assignSlotsByFrames,
  effectiveWeave,
  minimalPeriod,
  slotsPerFrame,
  specWeave,
  straightOf,
  threadingTemplate,
  warpThreadRepeat,
  weaveToThreading,
  withThreading,
  withoutThreading,
} from '../threading';
import { simulatePhysical } from '../physical/simulate';
import { constantPhysicalRandom } from '../physical/random';
import { buildFabricPositions } from '../physical/shrinkDistribution';
import { WEAVE_PRESETS } from '../../presets/weaves';
import { DEMO_DESENLER } from '../../app/demoDesenler';
import { atkiJsonToFabricSpec } from '../../adapters/atkiJson';
import { parseWif } from '../../importers/wif';
import { parseFabricJson, serializeFabricJson } from '../../importers/fabricJson';
import { fabricInputFromSpec } from '../../realistic/adapters/fromSpec';
import { packFabric, threadTable } from '../../realistic/pack';
import { tileFor } from '../../realistic/tile';
import { physicalExample } from '../../presets/physicalExample';
import type { FabricSpec } from '../types';

/** Karışık tahar 1-3-5-7-2-4-6-8 (0 tabanlı 0,2,4,6,1,3,5,7) + 8 çerçeveli dimi benzeri armür (8 atkı). */
function mixedExample(): { threading: number[]; liftplan: boolean[][] } {
  const threading = threadingTemplate('mixed', 8);
  const liftplan = Array.from({ length: 8 }, (_, j) => Array.from({ length: 8 }, (_, f) => (f - j + 8) % 8 < 3));
  return { threading, liftplan };
}

function baseSpec(over: Partial<FabricSpec> = {}): FabricSpec {
  return {
    ...physicalExample(6, 10),
    warpSlots: [
      { name: 'A', count: 300, system: 'Denier', color: '#e8e2d0', twist: 'S' },
      { name: 'B', count: 150, system: 'Denier', color: '#b04030', twist: 'Z' },
    ],
    warpSequence: [0],
    ...over,
  } as FabricSpec;
}

describe('tahar × armür → bağlantı', () => {
  it('üstte(i, j) = armür[j][tahar[i]]', () => {
    const { threading, liftplan } = mixedExample();
    const M = effectiveWeave(threading, liftplan);
    expect(M.length).toBe(8);
    expect(M[0].length).toBe(8);
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) expect(M[j][i]).toBe(liftplan[j][threading[i]]);
  });
  it('şablonlar', () => {
    expect(threadingTemplate('straight', 4)).toEqual([0, 1, 2, 3]);
    expect(threadingTemplate('pointed', 4)).toEqual([0, 1, 2, 3, 2, 1]);
    expect(threadingTemplate('broken', 4)).toEqual([0, 1, 2, 3, 1, 0, 3, 2]);
    expect(threadingTemplate('mixed', 8)).toEqual([0, 2, 4, 6, 1, 3, 5, 7]);
  });
  it('karışık tahar + armür = düz tahar + karşılık gelen örgü matrisi (klasik ve gerçekçi birebir)', () => {
    const { threading, liftplan } = mixedExample();
    const a = withThreading(baseSpec(), threading, liftplan, 8);
    const b: FabricSpec = withoutThreading(a);
    expect(b.threading).toBeUndefined();
    expect(b.weave).toEqual(a.weave);
    const view = { x0Mm: 0, y0Mm: 0, widthMm: 4, heightMm: 3, pxPerMm: 30 };
    const opts = { random: constantPhysicalRandom(), scaleBar: false } as const;
    const ra = simulatePhysical(a, view, opts);
    const rb = simulatePhysical(b, view, opts);
    expect(Buffer.from(ra.image.data).equals(Buffer.from(rb.image.data))).toBe(true);
    const pa = packFabric(fabricInputFromSpec(a));
    const pb = packFabric(fabricInputFromSpec(b));
    expect(Buffer.from(pa.weave.data).equals(Buffer.from(pb.weave.data))).toBe(true);
  });
});

describe('düz tahar geriye uyumluluk', () => {
  it('tahar yokken specWeave = weave; düz tahar yorumu aynı matrisi verir (hazır örgüler)', () => {
    for (const p of WEAVE_PRESETS) {
      expect(specWeave({ weave: p.weave })).toBe(p.weave);
      const s = straightOf(p.weave);
      expect(effectiveWeave(s.threading, s.liftplan)).toEqual(p.weave);
      const t = weaveToThreading(p.weave);
      expect(effectiveWeave(t.threading, t.liftplan)).toEqual(p.weave);
    }
  });
  it('demo desenler: tahar alanı yok, weave değişmez', () => {
    for (const d of DEMO_DESENLER) {
      const spec = atkiJsonToFabricSpec(d.json, d);
      expect(spec.threading).toBeUndefined();
      expect(specWeave(spec)).toBe(spec.weave);
    }
  });
  it('weaveToThreading: düz örgüde tahar 0..W−1; tekrar eden sütunlar aynı çerçeve', () => {
    const t = weaveToThreading(WEAVE_PRESETS[0].weave);
    expect(t.threading).toEqual(Array.from({ length: WEAVE_PRESETS[0].weave[0].length }, (_, i) => i));
    const w = [
      [true, false, true, false],
      [false, true, false, true],
    ];
    expect(weaveToThreading(w).threading).toEqual([0, 1, 0, 1]);
    expect(weaveToThreading(w).frames).toBe(2);
  });
});

describe('çerçeveye iplik ata', () => {
  it('karışık taharda F1–F4 = A, F5–F8 = B doğru tellere gider; ters görünüm doğru', () => {
    const { threading } = mixedExample(); // tel → çerçeve: 0,2,4,6,1,3,5,7
    const seq = assignSlotsByFrames(threading, [0], [
      { from: 0, to: 3, slot: 0 },
      { from: 4, to: 7, slot: 1 },
    ]);
    // tel i'nin çerçevesi < 4 → A (dizi en kısa periyoda indirgenir: tel bazında açarak karşılaştır)
    const full = threading.map((_, i) => seq[i % seq.length]);
    expect(full).toEqual(threading.map((f) => (f < 4 ? 0 : 1)));
    expect(full).toEqual([0, 0, 1, 1, 0, 0, 1, 1]);
    const per = slotsPerFrame(threading, seq, 8);
    expect(per.slice(0, 4).every((s) => s.length === 1 && s[0] === 0)).toBe(true);
    expect(per.slice(4).every((s) => s.length === 1 && s[0] === 1)).toBe(true);
  });
  it('aynı çerçevede birden fazla iplik bilgi olarak görünür; dizi en kısa periyoda iner', () => {
    const per = slotsPerFrame([0, 1, 0, 1], [0, 0, 1, 1], 2);
    expect(per[0]).toEqual([0, 1]);
    expect(assignSlotsByFrames([0, 1], [0], [{ from: 1, to: 1, slot: 1 }])).toEqual([0, 1]);
    expect(minimalPeriod([0, 1, 0, 1])).toEqual([0, 1]);
  });
});

describe('EKOK: tarak 3, tahar 8, iplik dizisi 6', () => {
  it('çözgü raporu 24; klasik ve gerçekçi (döşeme) tutarlı', () => {
    const { threading, liftplan } = mixedExample();
    const spec = withThreading(
      baseSpec({ warpSequence: [0, 0, 1, 0, 1, 1], reed: { reedNumber: 12, dentingReport: [2, 1, 0] } }),
      threading,
      liftplan,
      8,
    );
    expect(warpThreadRepeat(spec)).toBe(24);
    const pos = buildFabricPositions(spec);
    expect(pos.warp.period % 24).toBe(0);
    const input = fabricInputFromSpec(spec);
    expect(input.positions!.warp!.centersMm.length % 24).toBe(0);
    const tile = tileFor(input);
    expect(tile.threads[0] % 24).toBe(0);
    expect(() => threadTable(input, tile.threads)).not.toThrow();
  });
});

describe('WIF ve JSON eşlemesi', () => {
  const wif = (body: string) => `[WIF]\nVersion=1.1\n[CONTENTS]\nTHREADING=true\n${body}`;
  it('THREADING → tahar, TIEUP + TREADLING → armür; effectiveWeave = weave', () => {
    const r = parseWif(
      wif(`[WEAVING]\nShafts=4\nTreadles=4\nRising Shed=true\n[WARP]\nThreads=8\n[WEFT]\nThreads=4\n[THREADING]\n1=1\n2=3\n3=2\n4=4\n5=1\n6=3\n7=2\n8=4\n[TIEUP]\n1=1,2\n2=2,3\n3=3,4\n4=4,1\n[TREADLING]\n1=1\n2=2\n3=3\n4=4\n`),
    );
    expect(r.threading).toEqual([0, 2, 1, 3, 0, 2, 1, 3]);
    expect(r.frames).toBe(4);
    expect(r.liftplan![0]).toEqual([true, true, false, false]);
    expect(effectiveWeave(r.threading!, r.liftplan!)).toEqual(r.weave);
  });
  it('LIFTPLAN doğrudan armür; Rising Shed = false ters; çok çerçeveli tel → tahar yok (uyarı)', () => {
    const r = parseWif(wif(`[WEAVING]\nShafts=2\nRising Shed=false\n[WARP]\nThreads=2\n[WEFT]\nThreads=2\n[THREADING]\n1=1\n2=2\n[LIFTPLAN]\n1=1\n2=2\n`));
    expect(r.liftplan).toEqual([
      [false, true],
      [true, false],
    ]);
    expect(effectiveWeave(r.threading!, r.liftplan!)).toEqual(r.weave);
    const m = parseWif(wif(`[WEAVING]\nShafts=2\n[WARP]\nThreads=2\n[WEFT]\nThreads=1\n[THREADING]\n1=1,2\n2=2\n[LIFTPLAN]\n1=1\n`));
    expect(m.threading).toBeUndefined();
    expect(m.warnings.join(' ')).toMatch(/birden çok çerçeve/);
  });
  it('JSON tahar / armür / yarns / yarnId gidiş-dönüş; eski dosya okunur', () => {
    const { threading, liftplan } = mixedExample();
    const spec = withThreading(baseSpec(), threading, liftplan, 8);
    const withYarn = { ...spec, warpSlots: [{ ...spec.warpSlots[0], yarnId: 'y1' }, spec.warpSlots[1]], yarns: [{ id: 'y1' }] } as unknown as FabricSpec;
    const back = parseFabricJson(serializeFabricJson(withYarn)).spec;
    expect(back.threading).toEqual(threading);
    expect(back.liftplan).toEqual(spec.liftplan);
    expect(back.frames).toBe(8);
    expect(back.weave).toEqual(spec.weave);
    expect(back.warpSlots[0].yarnId).toBe('y1');
    expect(back.yarns).toEqual([{ id: 'y1' }]);
    const old = parseFabricJson(serializeFabricJson(physicalExample(0, 0))).spec;
    expect(old.threading).toBeUndefined();
    expect(old.weave).toEqual(physicalExample(0, 0).weave);
  });
});
