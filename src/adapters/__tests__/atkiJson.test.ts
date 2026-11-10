import { describe, expect, it } from 'vitest';
import {
  atkiJsonToFabricInput,
  atkiJsonToFabricSpec,
  ekok,
  expandAtkiProgram,
  kolorwayRenkleri,
  orguAnahtari,
  type AtkiJson,
} from '../atkiJson';
import { iplikOlustur } from '../iplik';
import { atkiJsonImporter } from '../../importers/atkiJson';
import lhotseRaw from '../../../samples/demo/lhotse-natural.atki.json';
import gardisetteRaw from '../../../samples/demo/gardisette-bendix-stripe.atki.json';

const lhotse = lhotseRaw as unknown as AtkiJson;
const gardisette = gardisetteRaw as unknown as AtkiJson;
const ID_8B50 = '8b50cfa1-06d0-4ab0-8e50-699689ad3589';
const ID_DIMI = 'e29bafd6-8e71-4fc2-a4e6-6b5f2d8cf712';

/** Küçük el yapımı desen: bant + grup×tekrar + boş örgü. */
const mini: AtkiJson = {
  desen: {
    ad: 'mini',
    cozguSiklik: 20,
    atkiSiklik: 18,
    program: {
      ogeler: [
        { tip: 'bant', orgu: { armur_desen_id: 'x', versiyon: 1 }, pick: 3, iplik: 1 },
        {
          tip: 'grup',
          tekrar: 2,
          ogeler: [
            { tip: 'bant', orgu: { armur_desen_id: '', versiyon: 0 }, pick: 2, iplik: 2 },
            { tip: 'bant', orgu: { armur_desen_id: 'x', versiyon: 2 }, pick: 1, iplik: 1 },
          ],
        },
      ],
      kenar: { orgu: [[1, 0], [0, 1]], cerceveler: [1, 2] },
    },
  },
  orguler: [
    { armur_desen_id: 'x', versiyon: 1, matris: { w: 3, h: 2, rows: ['100', '011'] } },
    { armur_desen_id: 'x', versiyon: 2, matris: { w: 4, h: 1, rows: ['1110'] } },
  ],
  varyasyonlar: [
    { ad: 'V1', kolorway: { 1: { renk: '#ff0000' }, 2: { renk: '#00ff00' }, zemin: { renk: '#0000ff' } } },
    { ad: 'V2', kolorway: { 1: { renk: '#111111' }, 2: { renk: '#222222' }, zemin: { renk: '#333333' } } },
  ],
};

describe('.atki.json program açılımı', () => {
  it('grup / tekrar özyinelemeli açılır; LHOTSE toplam 600 atkı (15/cm → 40 cm rapor)', () => {
    const a = expandAtkiProgram(lhotse);
    expect(a.rows.length).toBe(600);
    expect(a.weftIplik.length).toBe(600);
    expect(a.cozguSiklik).toBe(15);
    expect(a.atkiSiklik).toBe(15);
    const m = expandAtkiProgram(mini);
    expect(m.rows.length).toBe(3 + 2 * (2 + 1));
    expect(m.weftIplik).toEqual([1, 1, 1, 2, 2, 1, 2, 2, 1]);
  });

  it('örgü id + versiyon çiftiyle eşlenir: 8b50… v5 ve v114 farklı matris', () => {
    const v5 = lhotse.orguler.find((o) => orguAnahtari(o) === `${ID_8B50}@5`)!;
    const v114 = lhotse.orguler.find((o) => orguAnahtari(o) === `${ID_8B50}@114`)!;
    expect(v5.matris.rows).not.toEqual(v114.matris.rows);
    // Program: 90 + 16 (v5) atkı sonra; v114 bandı 90+16+40+40+16+16 = 218. atkıdan başlar
    const a = expandAtkiProgram(lhotse);
    const satir = (r: string) => Array.from(r, (c) => c === '1');
    expect(a.rows[90]).toEqual(satir(v5.matris.rows[0]));
    expect(a.rows[218]).toEqual(satir(v114.matris.rows[0]));
    expect(a.rows[90]).not.toEqual(a.rows[218]);
  });

  it('bulunamayan örgü (id doğru, versiyon yanlış) açık hata verir', () => {
    const bozuk: AtkiJson = JSON.parse(JSON.stringify(mini));
    (bozuk.desen.program.ogeler[0] as { orgu: { versiyon: number } }).orgu.versiyon = 9;
    expect(() => expandAtkiProgram(bozuk)).toThrow(/x@9/);
  });

  it('çözgü raporu = örgü genişliklerinin EKOK\'u (LHOTSE 8, Gardisette 4, mini 3·4·2 → 12)', () => {
    expect(ekok(4, 6)).toBe(12);
    expect(expandAtkiProgram(lhotse).width).toBe(8);
    expect(expandAtkiProgram(gardisette).width).toBe(4);
    const m = expandAtkiProgram(mini);
    expect(m.width).toBe(12);
    // örgü ene modulo ile döşenir
    expect(m.rows[0]).toEqual([true, false, false, true, false, false, true, false, false, true, false, false]);
  });

  it('boş örgü ("" v0) şimdilik bez ayağı (10/01)', () => {
    const m = expandAtkiProgram(mini);
    expect(m.rows[3].slice(0, 4)).toEqual([true, false, true, false]);
    expect(m.rows[4].slice(0, 4)).toEqual([false, true, false, true]);
  });

  it('atkı modu: bant içi (varsayılan) ↔ global atkı indeksi', () => {
    // mini 1. bant (x@1, h = 2) 3 atkı: bant içi 0,1,0; global aynı (bant 0'dan başlar)
    // grup içindeki boş örgü bandı global indeks 3'ten başlar: bant içi satır 0, global 3 % 2 = 1
    const b = expandAtkiProgram(mini);
    const g = expandAtkiProgram(mini, { atkiModu: 'global' });
    expect(b.rows[3].slice(0, 2)).toEqual([true, false]);
    expect(g.rows[3].slice(0, 2)).toEqual([false, true]);
  });

  it('satirTers / matrisTers', () => {
    const t = expandAtkiProgram(mini, { satirTers: true });
    expect(t.rows[0].slice(0, 3)).toEqual([false, true, true]);
    const m = expandAtkiProgram(mini, { matrisTers: true });
    expect(m.rows[0].slice(0, 3)).toEqual([false, true, true]);
  });

  it('LHOTSE 4/4 dimi (e29b… v70) bandı: matris satırları sırayla, bant içi indeksle', () => {
    const o = lhotse.orguler.find((x) => orguAnahtari(x) === `${ID_DIMI}@70`)!;
    const a = expandAtkiProgram(lhotse);
    for (let k = 0; k < 8; k++) expect(a.rows[106 + k]).toEqual(Array.from(o.matris.rows[k], (c) => c === '1'));
  });
});

describe('kolorway eşlemesi', () => {
  it('"zemin" = çözgü rengi, sayısal anahtar = atkı ipliği rengi; varyant değişince renkler değişir', () => {
    expect(kolorwayRenkleri(mini, 0).cozgu).toBe('#0000ff');
    expect(kolorwayRenkleri(mini, 0).atki(2)).toBe('#00ff00');
    expect(kolorwayRenkleri(mini, 1).atki(2)).toBe('#222222');
    const g3 = kolorwayRenkleri(gardisette, 0);
    expect(gardisette.varyasyonlar[0].ad).toBe('Varyant 3');
    expect(g3.cozgu).toBe('#a8926a');
    expect(gardisette.varyasyonlar).toHaveLength(9);
  });

  it('FabricInput: çözgü zemin renginde, atkılar atkı atkı kolorway renginde, iplik tipleri id ile', () => {
    const cozgu = iplikOlustur('c', '60/2 Ne');
    const atki = iplikOlustur('a', '10/1 Ne');
    const inp = atkiJsonToFabricInput(mini, { varyantIndex: 0, iplikler: [cozgu, atki], cozguIplikId: 'c', atkiIplikleri: { 1: 'a', 2: 'a' } });
    expect(inp.warp).toEqual([{ color: '#0000ff', yarnType: 0 }]);
    expect(inp.weft.map((w) => w.color).slice(0, 4)).toEqual(['#ff0000', '#ff0000', '#ff0000', '#00ff00']);
    expect(inp.yarnTypes).toHaveLength(2);
    expect(inp.yarnTypes[0]).toMatchObject({ count: 30, unit: 'Ne', plies: 2, structure: 'spun' });
    expect(inp.weave.warps).toBe(12);
    expect(inp.weave.wefts).toBe(9);
    expect(inp.density).toEqual({ warpPerCm: 20, weftPerCm: 18 });
  });

  it('FabricSpec: tek matris, çözgü 1 slot, atkı slotu iplik numarası başına; iplik tanımları id ile', () => {
    const s = atkiJsonToFabricSpec(gardisette, {
      varyantIndex: 5,
      iplikler: [iplikOlustur('c', '60/2 Ne'), iplikOlustur('a', '10/1 Ne')],
      cozguIplikId: 'c',
      atkiIplikleri: { 2: 'a', 3: 'a', 4: 'a', 5: 'a' },
    });
    expect(s.weave[0]).toHaveLength(4);
    expect(s.weftSequence).toHaveLength(296);
    expect(s.warpSlots).toHaveLength(1);
    expect(gardisette.varyasyonlar[5].ad).toBe('Varyant 6');
    expect(s.warpSlots[0]).toMatchObject({ count: 30, system: 'Ne', yarnId: 'c', color: gardisette.varyasyonlar[5].kolorway.zemin.renk });
    // atkı slotları ilk görünüş sırasıyla: iplik 4, 5, 2, 3
    expect(s.weftSlots.map((w) => w.color)).toEqual(['#9fb1b2', '#d8d5cf', '#185054', '#1f6f74']);
    expect(s.yarns?.map((y) => y.id)).toEqual(['c', 'a']);
  });

  it('içe aktarıcı: iplik numarası olmayan iplikler varsayılan tanımla gelir', () => {
    const b = atkiJsonImporter.load(JSON.stringify(lhotse));
    expect(b.iplikler.map((i) => i.id)).toEqual(['cozgu', 'atki-1', 'atki-2']);
    const spec = atkiJsonImporter.parse(JSON.stringify(lhotse));
    expect(spec.weave).toHaveLength(600);
    expect(() => atkiJsonImporter.parse('{"foo":1}')).toThrow(/atki\.json/);
  });
});
