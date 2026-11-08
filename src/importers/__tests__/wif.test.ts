import { describe, expect, it } from 'vitest';
import { parseIni, parseWif } from '../wif';
import { parseFabricJson, serializeFabricJson } from '../fabricJson';
import { atkiJsonImporter } from '../atkiJson';
import { plain, twill31 } from '../../presets/weaves';
import { physicalExample } from '../../presets/physicalExample';
import { colorsToSlots, minimalPeriod } from '../slots';

const HEADER = `[WIF]
Version=1.1
Source Program=test
[CONTENTS]
WEAVING=true
WARP=true
WEFT=true
THREADING=true
`;

const STRAIGHT_4 = `[THREADING]
1=1
2=2
3=3
4=4
`;

describe('parseIni', () => {
  it('bölüm/anahtarları küçük harfe indirir, yorumları atlar', () => {
    const s = parseIni('; yorum\n[Color Table]\n1 = 255,0,0 ; kırmızı\n');
    expect(s.get('color table')?.get('1')).toBe('255,0,0');
  });
});

describe('parseWif', () => {
  it('TIEUP + TREADLING ile bezayağı', () => {
    const wif = `${HEADER}[WEAVING]
Shafts=2
Treadles=2
Rising Shed=true
[WARP]
Threads=2
[WEFT]
Threads=2
[THREADING]
1=1
2=2
[TIEUP]
1=1
2=2
[TREADLING]
1=1
2=2
`;
    const r = parseWif(wif);
    expect(r.weave).toEqual([
      [true, false],
      [false, true],
    ]);
    expect(r.weave).toEqual(plain());
  });

  it('TIEUP + TREADLING ile 3/1 dimi (1. atkı = 0. satır, en alt)', () => {
    const wif = `${HEADER}[WEAVING]
Shafts=4
Treadles=4
[WARP]
Threads=4
[WEFT]
Threads=4
${STRAIGHT_4}[TIEUP]
1=1,2,3
2=2,3,4
3=3,4,1
4=4,1,2
[TREADLING]
1=1
2=2
3=3
4=4
`;
    const r = parseWif(wif);
    // 1. atkı: çerçeve 1,2,3 kalkar → çözgü 1-3 üstte
    expect(r.weave[0]).toEqual([true, true, true, false]);
    expect(r.weave).toEqual(twill31());
  });

  it('LIFTPLAN doğrudan çerçeveleri verir', () => {
    const wif = `${HEADER}[WARP]
Threads=4
[WEFT]
Threads=2
${STRAIGHT_4}[LIFTPLAN]
1=1,2
2=3,4
`;
    const r = parseWif(wif);
    expect(r.weave).toEqual([
      [true, true, false, false],
      [false, false, true, true],
    ]);
  });

  it('Rising Shed=false ise ters çevrilir', () => {
    const wif = `${HEADER}[WEAVING]
Rising Shed=false
[WARP]
Threads=4
[WEFT]
Threads=1
${STRAIGHT_4}[LIFTPLAN]
1=1
`;
    expect(parseWif(wif).weave).toEqual([[false, true, true, true]]);
  });

  it('COLOR TABLE ve Range ölçeklemesi, varsayılan renk', () => {
    const wif = `${HEADER}[COLOR PALETTE]
Entries=2
Range=0,65535
[COLOR TABLE]
1=65535,0,0
2=0,0,65535
[WARP]
Threads=2
Color=1
[WEFT]
Threads=2
Color=2
[WARP COLORS]
2=2
[THREADING]
1=1
2=2
[LIFTPLAN]
1=1
2=2
`;
    const r = parseWif(wif);
    expect(r.warpColors).toEqual(['#ff0000', '#0000ff']);
    expect(r.weftColors).toEqual(['#0000ff', '#0000ff']);
  });

  it('eksik bölümlerde açıklayıcı hata', () => {
    expect(() => parseWif(`${HEADER}[LIFTPLAN]\n1=1\n`)).toThrow(/THREADING/);
    expect(() => parseWif(`${HEADER}${STRAIGHT_4}`)).toThrow(/LIFTPLAN veya TREADLING/);
    expect(() => parseWif(`${HEADER}${STRAIGHT_4}[TREADLING]\n1=1\n`)).toThrow(/TIEUP/);
  });
});

describe('FabricSpec JSON', () => {
  /** v1 (eski) biçim: tek renk dizisi, tek iplik. */
  const v1 = {
    weave: plain(),
    warpColors: ['#111111'],
    weftColors: ['#eeeeee', '#cc0000'],
    warpYarn: { count: 30, system: 'Ne' as const },
    weftYarn: { count: 150, system: 'Denier' as const, fiberDensity: 1.14 },
    warpDensity: 30,
    weftDensity: 25,
    repeatX: 4,
    repeatY: 2,
  };

  it('v2 gidiş-dönüş korunur', () => {
    const spec = physicalExample(6, 10);
    const r = parseFabricJson(serializeFabricJson(spec));
    expect(r.migrated).toBe(false);
    expect(r.spec).toEqual(spec);
  });

  it('eski v1 JSON geriye uyumlu okunur: renkler → slot + sıra', () => {
    const r = parseFabricJson(JSON.stringify(v1));
    expect(r.migrated).toBe(true);
    expect(r.spec.version).toBe(2);
    expect(r.spec.weave).toEqual(plain());
    expect(r.spec.warpSlots).toHaveLength(1);
    expect(r.spec.warpSlots[0]).toMatchObject({ name: 'A', count: 30, system: 'Ne', color: '#111111' });
    expect(r.spec.weftSlots.map((s) => s.color)).toEqual(['#eeeeee', '#cc0000']);
    expect(r.spec.weftSlots[1]).toMatchObject({ count: 150, system: 'Denier' });
    expect(r.spec.weftSequence).toEqual([0, 1]);
    expect(r.spec.warpDensityLoom).toBe(30);
    expect(r.spec.weftDensityLoom).toBe(25);
    expect(r.spec.warpShrinkPct).toBe(0);
    expect(r.spec.warpCrimpShare).toBe(0.4);
    expect(r.warnings.join(' ')).toMatch(/fiberDensity/);
  });

  it('4\'ten fazla renk: en sık 4 slot, diğerleri en yakına birleşir', () => {
    const colors = ['#ff0000', '#ff0000', '#ff0000', '#00ff00', '#00ff00', '#0000ff', '#0000ff', '#ffffff', '#fe0101'];
    const r = colorsToSlots(colors, { count: 30, system: 'Ne' }, 'Çözgü');
    expect(r.slots.map((s) => s.color)).toEqual(['#ff0000', '#00ff00', '#0000ff', '#ffffff']);
    expect(r.sequence[8]).toBe(0); // #fe0101 → kırmızı (A)
    expect(r.warnings[0]).toMatch(/#fe0101→A/);
  });

  it('dizi en kısa periyoduna indirgenir', () => {
    expect(minimalPeriod([0, 1, 1, 0, 1, 1])).toEqual([0, 1, 1]);
    expect(minimalPeriod([0, 1, 2])).toEqual([0, 1, 2]);
  });

  it('geçersiz alanları reddeder', () => {
    expect(() => parseFabricJson('{')).toThrow(/JSON/);
    expect(() => parseFabricJson(JSON.stringify({ ...v1, weave: [[true], [true, false]] }))).toThrow(/satırı 1/);
    expect(() => parseFabricJson(JSON.stringify({ ...v1, warpYarn: { count: 1, system: 'xyz' } }))).toThrow(/system/);
    const bad = { ...physicalExample(), weftSequence: [0, 7] };
    expect(() => parseFabricJson(JSON.stringify(bad))).toThrow(/weftSequence/);
    const tooMany = { ...physicalExample(), warpSlots: [...physicalExample().weftSlots, physicalExample().weftSlots[0]] };
    expect(() => parseFabricJson(JSON.stringify(tooMany))).toThrow(/1–4 slot/);
  });
});

describe('.atki.json', () => {
  it('yalnızca arayüz var, parse TODO', () => {
    expect(atkiJsonImporter.accepts('kumas.atki.json')).toBe(true);
    expect(() => atkiJsonImporter.parse('{}')).toThrow(/TODO/);
  });
});
