/**
 * Demo desenler: Tezgah'tan dışa aktarılmış gerçek .atki.json dosyaları + iplik tanımları
 * (.atki.json iplik numarası taşımaz; iplikler desenden bağımsız tanımlanıp id ile bağlanır).
 */
import type { AtkiIplikEslemesi, AtkiJson } from '../adapters/atkiJson';
import { iplikOlustur, type IplikTanimi } from '../adapters/iplik';
import lhotseJson from '../../samples/demo/lhotse-natural.atki.json';
import gardisetteJson from '../../samples/demo/gardisette-bendix-stripe.atki.json';

export interface AtkiBelge extends Omit<AtkiIplikEslemesi, 'secenekler'> {
  /** Görünen ad. */
  ad: string;
  json: AtkiJson;
}

export interface DemoDesen extends AtkiBelge {
  key: string;
}

const gCozgu = iplikOlustur('gardisette-cozgu', '60/2 Ne', { ad: 'Çözgü 60/2 Ne' });
const gAtki = iplikOlustur('gardisette-atki', '10/1 Ne', { ad: 'Atkı 10/1 Ne' });
const lCozgu = iplikOlustur('lhotse-cozgu', '24/1 Ne', { ad: 'Çözgü 24/1 Ne' });
const lAtki1 = iplikOlustur('lhotse-atki-1', '24/1 Ne', { ad: 'Atkı 1 — 24/1 Ne' });
const lAtki2 = iplikOlustur('lhotse-atki-2', '900 denye', { ad: 'Atkı 2 — 900 dn tekstüre', tip: 'teksture', parlaklik: 'mat' });

/** Gardisette: atkı 1–5 ve kolorway'deki diğer numaralar 10/1 Ne eğrilmiş. */
const gardisetteAtki: Record<number, string> = Object.fromEntries(
  Object.keys((gardisetteJson as unknown as AtkiJson).varyasyonlar.reduce((acc, v) => ({ ...acc, ...v.kolorway }), {} as Record<string, unknown>))
    .filter((k) => /^\d+$/.test(k))
    .map((k) => [Number(k), gAtki.id]),
);

export const DEMO_DESENLER: DemoDesen[] = [
  {
    key: 'lhotse-natural',
    ad: 'Lhotse Natural',
    json: lhotseJson as unknown as AtkiJson,
    varyantIndex: 0,
    iplikler: [lCozgu, lAtki1, lAtki2],
    cozguIplikId: lCozgu.id,
    atkiIplikleri: { 1: lAtki1.id, 2: lAtki2.id },
  },
  {
    key: 'gardisette-bendix-stripe',
    ad: 'Gardisette Bendix Stripe',
    json: gardisetteJson as unknown as AtkiJson,
    varyantIndex: 0,
    iplikler: [gCozgu, gAtki],
    cozguIplikId: gCozgu.id,
    atkiIplikleri: gardisetteAtki,
  },
];

export type { IplikTanimi };
