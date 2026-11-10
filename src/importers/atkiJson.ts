import type { FabricSpec } from '../render-engine';
import { atkiJsonToFabricSpec, parseAtkiJson, type AtkiJson } from '../adapters/atkiJson';
import { varsayilanIplik, type IplikTanimi } from '../adapters/iplik';

/**
 * .atki.json (Tezgah atkı deseni) içe aktarıcı. Dosya iplik numarası taşımaz: çözgü ve her atkı iplik numarası
 * için varsayılan iplik tanımı (`varsayilanIplik`, 20/1 Ne eğrilmiş) oluşturulur; panelden düzenlenebilir.
 */
export interface AtkiJsonImporter {
  /** Dosya uzantısı kontrolü. */
  accepts(fileName: string): boolean;
  /** .atki.json metni → belge (json + iplik eşlemesi). Uygulama varyant / seçenek değişince yeniden açar. */
  load(text: string): { json: AtkiJson; iplikler: IplikTanimi[]; cozguIplikId: string; atkiIplikleri: Record<number, string> };
  /** Varsayılan varyant ve seçeneklerle doğrudan FabricSpec. */
  parse(text: string): Partial<FabricSpec>;
}

/** Desendeki atkı iplik numaraları (kolorway anahtarları). */
function atkiNumaralari(json: AtkiJson): number[] {
  const set = new Set<number>();
  for (const v of json.varyasyonlar) for (const k of Object.keys(v.kolorway)) if (/^\d+$/.test(k)) set.add(Number(k));
  return [...set].sort((a, b) => a - b);
}

export const atkiJsonImporter: AtkiJsonImporter = {
  accepts: (fileName) => fileName.toLowerCase().endsWith('.atki.json'),
  load(text) {
    const json = parseAtkiJson(text);
    const cozgu = varsayilanIplik('cozgu', 'Çözgü');
    const atkilar = atkiNumaralari(json).map((n) => varsayilanIplik(`atki-${n}`, `Atkı ${n}`));
    return {
      json,
      iplikler: [cozgu, ...atkilar],
      cozguIplikId: cozgu.id,
      atkiIplikleri: Object.fromEntries(atkiNumaralari(json).map((n) => [n, `atki-${n}`])),
    };
  },
  parse(text) {
    const b = this.load(text);
    return atkiJsonToFabricSpec(b.json, { ...b, varyantIndex: 0 });
  },
};
