/**
 * İplik tanımları (saf; React / DOM / uygulama state'i yok — Tezgah'a aynen taşınır).
 *
 * İplikler desenden bağımsız, kimlikli veri nesneleridir; desen girdisi bunlara `id` ile referans verir.
 * Sonraki turda bir iplik kütüphanesinde saklanacaklar.
 *
 * Numara notasyonu: "60/2 Ne" = 2 katlı, tek kat Ne 60 → sonuç numara Ne 30. Çap sonuç numaradan hesaplanır
 * (realistic/yarn.ts diameterMm); kat sayısı geometriye / yüzeye (kat oluğu) gider.
 */
import type { CountUnit, Luster, YarnType } from '../realistic/types';

export type IplikBirim = CountUnit;
export type IplikTip = 'egrilmis' | 'filament' | 'teksture' | 'yassi';
export type BukumSeviye = 'az' | 'orta' | 'yuksek';
export type Parlaklik = 'mat' | 'yari-mat' | 'parlak';

export interface IplikTanimi {
  id: string;
  ad: string;
  /** Tek kat numarası (ör. "60/2 Ne" için 60). */
  numara: number;
  birim: IplikBirim;
  /** Kat sayısı (ör. "60/2 Ne" için 2). */
  katSayisi: number;
  tip: IplikTip;
  /** Büküm: tur/m ya da seviye. */
  bukum: number | BukumSeviye;
  /** Büküm yönü (verilmezse Z). */
  bukumYonu?: 'S' | 'Z';
  parlaklik: Parlaklik;
  /** Tüylülük 0..1. */
  tuyluluk: number;
}

const DOLAYLI: ReadonlySet<IplikBirim> = new Set(['Ne', 'Nm']);

export interface NumaraAyrisma {
  tekKat: number;
  kat: number;
  birim: IplikBirim;
  /** Sonuç (katlı iplik) numarası, aynı birimde. */
  sonuc: number;
}

/**
 * Katlı ipliğin sonuç numarası. Dolaylı sistemde (Ne, Nm; numara büyüdükçe incelir) n kat → N / n;
 * doğrudan sistemde (Tex, Dtex, Denier; kütle / uzunluk) n kat → N · n. Büküm büzülmesi yok sayılır (VARSAYIM).
 */
export function sonucNumara(tekKat: number, kat: number, birim: IplikBirim): number {
  const k = Math.max(1, Math.round(kat));
  return DOLAYLI.has(birim) ? tekKat / k : tekKat * k;
}

const BIRIMLER: Record<string, IplikBirim> = {
  ne: 'Ne',
  nm: 'Nm',
  dtex: 'Dtex',
  denier: 'Denier',
  denye: 'Denier',
  den: 'Denier',
  dn: 'Denier',
  tex: 'Tex',
};

/** "60/2 Ne", "24/1 Ne", "900 denye", "167 dtex" → ayrışma. Kat yazılmazsa 1. */
export function parseNumara(text: string): NumaraAyrisma {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(?:\/\s*(\d+))?\s*([a-zA-Z]+)\s*$/.exec(text);
  if (!m) throw new Error(`İplik numarası okunamadı: "${text}" (ör. "60/2 Ne", "900 denye")`);
  const tekKat = parseFloat(m[1].replace(',', '.'));
  const kat = m[2] ? parseInt(m[2], 10) : 1;
  const birim = BIRIMLER[m[3].toLowerCase()];
  if (!birim) throw new Error(`Bilinmeyen birim: "${m[3]}"`);
  if (!(tekKat > 0) || !(kat >= 1)) throw new Error(`Geçersiz iplik numarası: "${text}"`);
  return { tekKat, kat, birim, sonuc: sonucNumara(tekKat, kat, birim) };
}

/** Birimden varsayılan tip: pamuk / yün numaraları (Ne, Nm) eğrilmiş, sentetik (Denier, Dtex, Tex) filament. */
export function varsayilanTip(birim: IplikBirim): IplikTip {
  return DOLAYLI.has(birim) ? 'egrilmis' : 'filament';
}

/**
 * Büküm seviyesi → tur/m. Eğrilmiş iplikte T = α·√Ne·39.37 (α: Ne büküm katsayısı, tur/inç; 39.37 inç/m).
 * VARSAYIM (kalibre edilecek): α az 3.0 (yumuşak, atkı), orta 3.8 (normal), yüksek 4.6 (sert, krep altı).
 * Filament / tekstüre için seviye düşük sabit tur/m'ye karşılık gelir (az 0, orta 150, yüksek 600).
 */
export const BUKUM_ALFA: Record<BukumSeviye, number> = { az: 3.0, orta: 3.8, yuksek: 4.6 };
export const FILAMENT_BUKUM: Record<BukumSeviye, number> = { az: 0, orta: 150, yuksek: 600 };

/** Numara → Ne (sonuç numara üzerinden; tex = 590.5 / Ne). */
export function neOf(numara: number, birim: IplikBirim): number {
  switch (birim) {
    case 'Ne':
      return numara;
    case 'Nm':
      return numara / 1.693;
    case 'Tex':
      return 590.5 / numara;
    case 'Dtex':
      return 5905 / numara;
    case 'Denier':
      return 5315 / numara;
  }
}

export function bukumTurM(i: IplikTanimi): number {
  if (typeof i.bukum === 'number') return Math.max(0, i.bukum);
  if (i.tip !== 'egrilmis') return FILAMENT_BUKUM[i.bukum];
  const ne = neOf(sonucNumara(i.numara, i.katSayisi, i.birim), i.birim);
  return BUKUM_ALFA[i.bukum] * Math.sqrt(ne) * 39.37;
}

/** Tipe göre varsayılan yüzey (parlaklık, tüylülük) — iplik dosyası bu alanları vermezse. */
export function varsayilanYuzey(tip: IplikTip): { parlaklik: Parlaklik; tuyluluk: number } {
  switch (tip) {
    case 'egrilmis':
      return { parlaklik: 'mat', tuyluluk: 0.3 };
    case 'filament':
      return { parlaklik: 'parlak', tuyluluk: 0 };
    case 'teksture':
      return { parlaklik: 'mat', tuyluluk: 0.15 };
    case 'yassi':
      return { parlaklik: 'parlak', tuyluluk: 0 };
  }
}

/** Numara metninden tam tanım ("60/2 Ne" → 2 katlı eğrilmiş). Tip birimden; diğer alanlar varsayılan, üzerine yazılabilir. */
export function iplikOlustur(id: string, numaraMetni: string, ek: Partial<IplikTanimi> = {}): IplikTanimi {
  const n = parseNumara(numaraMetni);
  const tip = ek.tip ?? varsayilanTip(n.birim);
  return {
    id,
    ad: ek.ad ?? `${n.tekKat}/${n.kat} ${n.birim}`,
    numara: n.tekKat,
    birim: n.birim,
    katSayisi: n.kat,
    tip,
    bukum: 'orta',
    ...varsayilanYuzey(tip),
    ...ek,
  };
}

/** Numarası bilinmeyen iplik (ör. .atki.json yalnız iplik numarası / renk verir): 20/1 Ne eğrilmiş. VARSAYIM. */
export function varsayilanIplik(id: string, ad = `İplik ${id}`): IplikTanimi {
  return iplikOlustur(id, '20/1 Ne', { ad });
}

const PARLAKLIK: Record<Parlaklik, Luster> = { mat: 'mat', 'yari-mat': 'yarimat', parlak: 'parlak' };
const YAPI: Record<IplikTip, NonNullable<YarnType['structure']>> = {
  egrilmis: 'spun',
  filament: 'filament',
  teksture: 'textured',
  yassi: 'tape',
};

/** Tanım → gerçekçi modun iplik tipi. Numara sonuç numaradır (çap ondan); kat sayısı yüzeye (kat oluğu). */
export function iplikToYarnType(i: IplikTanimi): YarnType {
  return {
    count: sonucNumara(i.numara, i.katSayisi, i.birim),
    unit: i.birim,
    twist: i.bukumYonu ?? 'Z',
    twistPerM: bukumTurM(i),
    luster: PARLAKLIK[i.parlaklik],
    hairiness: i.tip === 'filament' || i.tip === 'yassi' ? 0 : Math.max(0, Math.min(1, i.tuyluluk)),
    plies: Math.max(1, Math.round(i.katSayisi)),
    structure: YAPI[i.tip],
  };
}
