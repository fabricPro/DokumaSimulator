/**
 * Tezgah .atki.json → simülatör girdisi (saf; React / DOM / uygulama state'i yok — Tezgah'a aynen taşınır).
 *
 * Dosya (tur 'tezgah-atki-desen', surum 1):
 *  - desen.program.ogeler: atkı programı. 'bant' = `pick` adet atkı, verilen örgü ve iplik numarası;
 *    'grup' = içindeki ögeler × `tekrar`. Açılım atkı atkı tam rapor dizisidir.
 *  - orguler: armür örgüleri. Eşleme (armur_desen_id, versiyon) ÇİFTİYLE — aynı id'nin farklı versiyonları
 *    farklı matris taşıyabilir (ör. LHOTSE 8b50… v5 ≠ v114).
 *  - varyasyonlar[k].kolorway: sayısal anahtar = atkı iplik numarasının rengi; "zemin" = ÇÖZGÜ rengi.
 *  - desen.cozguSiklik / atkiSiklik: tel/cm, atkı/cm.
 *  - program.kenar (kenar örgüsü): veride korunur, render'a girmez (şimdilik yok sayılır).
 *
 * Yön kuralları (Tezgah'tan DOĞRULANMADI — seçeneklerle çevrilebilir):
 *  - Çözgü yönü: her bant kendi örgüsünü tüm ene modulo ile döşer; çözgü raporu = kullanılan örgü genişliklerinin EKOK'u.
 *  - Atkı yönü: varsayılan, bant içinde örgü satırı bandın başından itibaren bant-içi atkı indeksine göre ilerler
 *    (`atkiModu: 'bant'`); alternatif global atkı indeksine göre (`'global'`).
 *  - Matris: rows[0] = bandın ilk atkısı (kumaşta alttaki), '1' = çözgü üstte. `satirTers` satır sırasını,
 *    `matrisTers` 0/1'i çevirir.
 */
import type { FabricSpec, YarnSlot } from '../render-engine/types';
import type { FabricInput } from '../realistic/types';
import { iplikToYarnType, sonucNumara, varsayilanIplik, type IplikTanimi } from './iplik';

export interface AtkiOrguRef {
  armur_desen_id: string;
  versiyon: number;
}
export type AtkiOge =
  | { tip: 'bant'; orgu: AtkiOrguRef; pick: number; iplik: number }
  | { tip: 'grup'; ad?: string; tekrar: number; ogeler: AtkiOge[] };

export interface AtkiJson {
  tur?: string;
  surum?: number;
  desen: {
    ad: string;
    cozguSiklik: number;
    atkiSiklik: number;
    program: { ogeler: AtkiOge[]; kenar?: unknown };
  };
  orguler: Array<AtkiOrguRef & { ad?: string; matris: { w: number; h: number; rows: string[] } }>;
  varyasyonlar: Array<{ ad: string; sira?: number; kolorway: Record<string, { renk: string }> }>;
}

export interface AtkiSecenekler {
  /** Bant içinde örgü satırı: 'bant' (varsayılan) bant-içi atkı indeksi, 'global' rapordaki atkı indeksi. */
  atkiModu: 'bant' | 'global';
  /** Örgü matrisinin satır sırasını ters çevir (rows[0] bandın son atkısı gibi). */
  satirTers: boolean;
  /** 0/1'i ters çevir ('1' = atkı üstte gibi). */
  matrisTers: boolean;
}
export const VARSAYILAN_SECENEKLER: AtkiSecenekler = { atkiModu: 'bant', satirTers: false, matrisTers: false };

/** Boş örgü (armur_desen_id "" ve versiyon 0): Tezgah'ta örgü atanmamış bant. ŞİMDİLİK bez ayağı 2×2 (10/01) olarak yorumlanır. */
const BOS_ORGU_BEZ: boolean[][] = [
  [true, false],
  [false, true],
];

export const orguAnahtari = (r: AtkiOrguRef) => `${r.armur_desen_id}@${r.versiyon}`;
const bosMu = (r: AtkiOrguRef) => r.armur_desen_id === '' && r.versiyon === 0;

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : Math.abs(a));
export const ekok = (a: number, b: number) => (a / gcd(a, b)) * b;

export interface AtkiAcilim {
  /** Atkı × çözgü raporu (EKOK), true = çözgü üstte. Satır 0 = ilk atkı (kumaşta alt). */
  rows: boolean[][];
  /** Atkı başına iplik numarası. */
  weftIplik: number[];
  /** Çözgü raporu genişliği (EKOK). */
  width: number;
  cozguSiklik: number;
  atkiSiklik: number;
  /** Kenar örgüsü: korunur, render'a girmez. */
  kenar: unknown;
}

/** Örgü tablosu (id + versiyon çiftiyle) ve 0/1 matrisler. */
function orguTablosu(json: AtkiJson, s: AtkiSecenekler): Map<string, boolean[][]> {
  const m = new Map<string, boolean[][]>();
  for (const o of json.orguler) {
    const { w, h, rows } = o.matris;
    if (rows.length !== h || rows.some((r) => r.length !== w)) throw new Error(`Örgü ${orguAnahtari(o)}: matris ${w}×${h} değil.`);
    let mat = rows.map((r) => Array.from(r, (c) => (c === '1') !== s.matrisTers));
    if (s.satirTers) mat = mat.slice().reverse();
    m.set(orguAnahtari(o), mat);
  }
  return m;
}

/** Programı atkı atkı açar (gruplar tekrar sayısıyla). */
export function expandAtkiProgram(json: AtkiJson, secenekler: Partial<AtkiSecenekler> = {}): AtkiAcilim {
  const s = { ...VARSAYILAN_SECENEKLER, ...secenekler };
  const tablo = orguTablosu(json, s);
  let bez = s.matrisTers ? BOS_ORGU_BEZ.map((r) => r.map((v) => !v)) : BOS_ORGU_BEZ;
  if (s.satirTers) bez = bez.slice().reverse();
  // 1) Bant listesi
  const bantlar: Array<{ mat: boolean[][]; pick: number; iplik: number }> = [];
  const ac = (ogeler: AtkiOge[], derinlik: number) => {
    if (derinlik > 32) throw new Error('Atkı programı çok derin (döngü?).');
    for (const o of ogeler) {
      if (o.tip === 'bant') {
        const mat = bosMu(o.orgu) ? bez : tablo.get(orguAnahtari(o.orgu));
        if (!mat) throw new Error(`Örgü bulunamadı: ${orguAnahtari(o.orgu)} (id + versiyon).`);
        if (!(o.pick > 0)) continue;
        bantlar.push({ mat, pick: o.pick, iplik: o.iplik });
      } else if (o.tip === 'grup') {
        for (let k = 0; k < Math.max(0, o.tekrar); k++) ac(o.ogeler, derinlik + 1);
      } else {
        throw new Error(`Bilinmeyen program ögesi: ${(o as { tip: string }).tip}`);
      }
    }
  };
  ac(json.desen.program.ogeler, 0);
  if (bantlar.length === 0) throw new Error('Atkı programı boş.');
  // 2) Çözgü raporu: kullanılan örgü genişliklerinin EKOK'u
  const width = bantlar.reduce((w, b) => ekok(w, b.mat[0].length), 1);
  // 3) Atkı atkı satırlar
  const rows: boolean[][] = [];
  const weftIplik: number[] = [];
  for (const b of bantlar) {
    const h = b.mat.length;
    const w = b.mat[0].length;
    for (let k = 0; k < b.pick; k++) {
      const r = b.mat[(s.atkiModu === 'bant' ? k : rows.length) % h];
      rows.push(Array.from({ length: width }, (_, c) => r[c % w]));
      weftIplik.push(b.iplik);
    }
  }
  return {
    rows,
    weftIplik,
    width,
    cozguSiklik: json.desen.cozguSiklik,
    atkiSiklik: json.desen.atkiSiklik,
    kenar: json.desen.program.kenar ?? null,
  };
}

/** Kolorway: sayısal anahtar → atkı iplik rengi, "zemin" → çözgü rengi. */
export function kolorwayRenkleri(json: AtkiJson, varyantIndex: number): { cozgu: string; atki: (n: number) => string } {
  const v = json.varyasyonlar[varyantIndex];
  if (!v) throw new Error(`Varyant ${varyantIndex} yok (${json.varyasyonlar.length} varyant).`);
  const kw = v.kolorway;
  return {
    cozgu: kw.zemin?.renk ?? '#ffffff',
    atki: (n) => {
      const c = kw[String(n)]?.renk;
      if (!c) throw new Error(`Varyant "${v.ad}": atkı ipliği ${n} için renk yok.`);
      return c;
    },
  };
}

export interface AtkiIplikEslemesi {
  varyantIndex: number;
  /** İplik kütüphanesi (id ile referans). */
  iplikler: IplikTanimi[];
  /** Çözgü ipliğinin id'si. */
  cozguIplikId: string;
  /** Atkı iplik numarası → iplik id. Verilmezse String(numara) id'li iplik, o da yoksa varsayılan iplik. */
  atkiIplikleri?: Record<number, string>;
  secenekler?: Partial<AtkiSecenekler>;
}

function iplikBul(e: AtkiIplikEslemesi, id: string): IplikTanimi {
  return e.iplikler.find((i) => i.id === id) ?? varsayilanIplik(id);
}
function atkiIplikId(e: AtkiIplikEslemesi, n: number): string {
  return e.atkiIplikleri?.[n] ?? String(n);
}

/** .atki.json → gerçekçi modun girdisi (tam rapor; renk / tip dizileri atkı atkı). */
export function atkiJsonToFabricInput(json: AtkiJson, e: AtkiIplikEslemesi): FabricInput {
  const a = expandAtkiProgram(json, e.secenekler);
  const renk = kolorwayRenkleri(json, e.varyantIndex);
  const data = new Uint8Array(a.width * a.rows.length);
  a.rows.forEach((r, j) => r.forEach((v, i) => (data[j * a.width + i] = v ? 1 : 0)));
  // İplik tipleri: çözgü + kullanılan atkı iplikleri (id başına bir tip)
  const ids = [e.cozguIplikId, ...new Set(a.weftIplik.map((n) => atkiIplikId(e, n)))].filter((v, k, l) => l.indexOf(v) === k);
  const typeIndex = new Map(ids.map((id, k) => [id, k]));
  return {
    weave: { warps: a.width, wefts: a.rows.length, data },
    warp: [{ color: renk.cozgu, yarnType: 0 }],
    weft: a.weftIplik.map((n) => ({ color: renk.atki(n), yarnType: typeIndex.get(atkiIplikId(e, n))! })),
    yarnTypes: ids.map((id) => iplikToYarnType(iplikBul(e, id))),
    density: { warpPerCm: a.cozguSiklik, weftPerCm: a.atkiSiklik },
  };
}

const SLOT_ADLARI = ['A', 'B', 'C', 'D'] as const;

/**
 * .atki.json → uygulamanın FabricSpec'i (CPU render, metrikler ve gerçekçi katman bundan beslenir).
 * Tek örgü matrisi (atkı × EKOK); çözgü 1 slot; atkı slotları = kullanılan iplik numaraları (A–D, en fazla 4);
 * `weftSequence` atkı başına slot. Slotlar `yarnId` ile `spec.yarns`'taki tanıma bağlı; numara / sistem aynalanır.
 */
export function atkiJsonToFabricSpec(json: AtkiJson, e: AtkiIplikEslemesi): FabricSpec {
  const a = expandAtkiProgram(json, e.secenekler);
  const renk = kolorwayRenkleri(json, e.varyantIndex);
  const kullanilan = [...new Set(a.weftIplik)];
  if (kullanilan.length > SLOT_ADLARI.length) {
    throw new Error(`Bu desende ${kullanilan.length} farklı atkı ipliği var; simülatör en fazla ${SLOT_ADLARI.length} atkı slotu destekliyor.`);
  }
  const yarns: IplikTanimi[] = [];
  const iplik = (id: string) => {
    const t = iplikBul(e, id);
    if (!yarns.some((y) => y.id === t.id)) yarns.push(t);
    return t;
  };
  const slot = (name: (typeof SLOT_ADLARI)[number], t: IplikTanimi, color: string): YarnSlot => ({
    name,
    count: sonucNumara(t.numara, t.katSayisi, t.birim),
    system: t.birim,
    color,
    twist: t.bukumYonu ?? 'Z',
    yarnId: t.id,
  });
  const warp = iplik(e.cozguIplikId);
  const slotOf = new Map(kullanilan.map((n, k) => [n, k]));
  return {
    version: 2,
    weave: a.rows,
    warpSlots: [slot('A', warp, renk.cozgu)],
    weftSlots: kullanilan.map((n, k) => slot(SLOT_ADLARI[k], iplik(atkiIplikId(e, n)), renk.atki(n))),
    warpSequence: [0],
    weftSequence: a.weftIplik.map((n) => slotOf.get(n)!),
    warpDensityLoom: a.cozguSiklik,
    weftDensityLoom: a.atkiSiklik,
    warpShrinkPct: 0,
    weftShrinkPct: 0,
    warpCrimpShare: 0.4,
    yarns,
  };
}

/** Basit şema kontrolü (içe aktarmada anlaşılır hata için). */
export function parseAtkiJson(text: string): AtkiJson {
  const j = JSON.parse(text) as AtkiJson;
  if (!j || typeof j !== 'object' || !j.desen?.program?.ogeler || !Array.isArray(j.orguler) || !Array.isArray(j.varyasyonlar)) {
    throw new Error('Geçerli bir .atki.json değil (desen.program.ogeler / orguler / varyasyonlar eksik).');
  }
  return j;
}
