import { describe, expect, it } from 'vitest';
import { parseIni, parseWif } from '../wif';
import { parseFabricJson, serializeFabricJson } from '../fabricJson';
import { atkiJsonImporter } from '../atkiJson';
import { plain, twill31 } from '../../presets/weaves';

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
  const spec = {
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
  it('gidiş-dönüş korunur', () => {
    expect(parseFabricJson(serializeFabricJson(spec))).toEqual(spec);
  });
  it('geçersiz alanları reddeder', () => {
    expect(() => parseFabricJson('{')).toThrow(/JSON/);
    expect(() => parseFabricJson(JSON.stringify({ ...spec, weave: [[true], [true, false]] }))).toThrow(/satırı 1/);
    expect(() => parseFabricJson(JSON.stringify({ ...spec, warpYarn: { count: 1, system: 'tex' } }))).toThrow(/system/);
  });
});

describe('.atki.json', () => {
  it('yalnızca arayüz var, parse TODO', () => {
    expect(atkiJsonImporter.accepts('kumas.atki.json')).toBe(true);
    expect(() => atkiJsonImporter.parse('{}')).toThrow(/TODO/);
  });
});
