import type { FabricSpec } from '../render-engine';

/**
 * .atki.json içe aktarıcı sözleşmesi.
 *
 * TODO: Format henüz tanımlı değil — kullanıcı örnek bir .atki.json dosyası verecek.
 * Dosya geldiğinde `parse` gerçeklenecek ve App'teki içe aktarma menüsüne bağlanacak.
 */
export interface AtkiJsonImporter {
  /** Dosya uzantısı kontrolü. */
  accepts(fileName: string): boolean;
  /** .atki.json metnini FabricSpec'e (veya kısmi spec'e) çevirir. */
  parse(text: string): Partial<FabricSpec>;
}

export const atkiJsonImporter: AtkiJsonImporter = {
  accepts: (fileName) => fileName.toLowerCase().endsWith('.atki.json'),
  parse: () => {
    throw new Error('TODO: .atki.json formatı henüz desteklenmiyor (örnek dosya bekleniyor).');
  },
};
