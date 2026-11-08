# Dokuma Simülatörü

Armür örgü matrisi, iplik numaraları, tezgah sıklıkları ve çekmelerden **fiziksel ölçekli** (mm)
kumaş görüntüsü ve kumaş metrikleri üretir. Render ve metrikler `reference/weave_phys.py`
referans implementasyonunun birebir TypeScript karşılığıdır (v2). Önceki cell tabanlı heightfield
render (`reference/weave_render.py` karşılığı, v1) motorda korunur.

## Çalıştırma

```bash
npm install
npm run dev            # http://localhost:5173
npm test               # Vitest
npm run build          # tsc + vite build
npm run samples:phys   # v2: referans örneğini 3 çekme durumunda samples/ts/ altına render eder
npm run samples        # v1: 5 örgü, samples/ts/out_*.png
npm run calibrate      # calibration/samples/*.json için sapma tablosu + parametre önerisi
```

Python betikleri bu makinede `python` ile çalışır (numpy, scipy, Pillow gerekir).

## Klasörler

| Yol | İçerik |
| --- | --- |
| `src/render-engine/` | **Taşınabilir motor** (React/DOM bağımlılığı yok) |
| `src/render-engine/physical/` | v2: iplik fiziği, konum üretici, çekme, sıkışma, metrikler, simülasyon |
| `src/render-engine/heightfield/` | v1: cell tabanlı heightfield render |
| `src/importers/` | WIF, FabricSpec JSON (v1 → v2 göçü), renk → slot, `.atki.json` arayüzü (TODO) |
| `src/presets/` | Hazır örgüler, referans fiziksel örnek |
| `src/app/` | İnce React kabuğu |
| `calibration/` | Numune kayıt şeması ve örnek kayıtlar |
| `reference/` | Python referansları |
| `samples/reference/`, `samples/ts/`, `samples/compare/` | Referans çıktıları, TS çıktıları, yan yana karşılaştırmalar |
| `scripts/` | Örnek üretimi, referans harness'ları, karşılaştırma, kalibrasyon |

## v2 modelleri (`src/render-engine/physical/`)

| Modül | İçerik |
| --- | --- |
| `yarnPhysics.ts` | `toTex` (Ne 590.5/Ne, Nm 1000/Nm, Dtex /10, Denier /9, Tex), `diameterMm = 0.0357·√(tex/ρ)`, ρ = iplik hacim yoğunluğu (varsayılan 0.85) |
| `positions.ts` | `PositionGenerator` arayüzü + `UniformPositionGenerator`. Tarak raporlu üretici (diş sıklığı + diş başına tel, ör. 2-2-3-0) için tasarım notu dosyada |
| `shrinkage.ts` | mamul çözgü = tezgah çözgü / (1 − atkı çekmesi); mamul atkı = tezgah atkı / (1 − çözgü çekmesi) |
| `squeeze.ts` | komşu çakışmada orantılı daralma s (yükseklik s^−0.5, alt sınır 0.55 → "sıkıştı"), Ashenhurst `10/d·E/(E+I)` |
| `metrics.ts` | mamul sıklık, örtme `1−(1−c1)(1−c2)`, Peirce kıvrımı `8/3·(h/p)²·I/E`, kıvrımlı gramaj, sıkışma oranı ve uyarı seviyesi |
| `simulate.ts` | mm koordinatlı heightfield: piksel → en yakın iplik (ikili arama), çapraz iplik aralığında dalga, iplik başına yarıçap/sıkışma/büküm (1.5r), yarıçapa göre ölçeklenen gürültü/gölge, beyaz patlaması düzeltmesi, 1 mm ölçek çubuğu |

**Uyarılar:** Ashenhurst oranı kesin sınır değildir — %100 üstü sarı, %115 üstü kırmızı uyarı.
Asıl hata durumu squeeze'in **sıkıştı** işaretidir (s < 0.55).

**Metrik ortalaması:** referans ortalama çap/tex'i görünüm penceresindeki ipliklerden alır.
TS'te `computeMetrics(spec, { warpSlotsUsed, weftSlotsUsed })` ile aynısı yapılır (doğrulama bunu
kullanır); uygulamadaki metrik çubuğu ise pencereden bağımsız olsun diye bir rapor döngüsünün
ortalamasını kullanır, bu yüzden referans etiketinden birkaç g/m² farklı olabilir.
Açıklık % render'daki arka plan piksel oranıdır ve pencereye bağlıdır.

### FabricSpec v2

```ts
{
  version: 2,
  weave: boolean[][],                         // satır 0 = ilk atkı (en altta), true = çözgü üstte
  warpSlots: YarnSlot[], weftSlots: YarnSlot[],   // en fazla 4: A B C D
  warpSequence: number[], weftSequence: number[], // slot sırası raporu, örgüden bağımsız uzunluk
  warpDensityLoom, weftDensityLoom,           // tel/cm, atkı/cm
  warpShrinkPct, weftShrinkPct,               // %
  warpCrimpShare                              // 0.4
}
YarnSlot = { name, count, system: 'Ne'|'Nm'|'Dtex'|'Denier'|'Tex', color, yarnDensity?, twist: 'S'|'Z' }
```

Eski JSON'lar (renk dizisi + tek iplik) otomatik çevrilir: her renk bir slot, dizi en kısa periyoduna
indirgenir. 4'ten fazla renk varsa en sık 4 renk slot olur, diğerleri en yakın slota birleştirilir ve
uyarı gösterilir. WIF içe aktarma da aynı kuralı kullanır. Referansın çizdiği büküm yönü S'dir; Z kesit
içi terimi ters çevirir.

## Referansla doğrulama

```bash
# Gürültüsüz: rng sabitlenir (uniform → aralık ortası, normal → 0); piksel + metrik karşılaştırma
python -I scripts/phys_harness.py <klasör>/ref flat
npx tsx scripts/render-phys-samples.ts flat <klasör>/ts
python -I scripts/compare_phys.py <klasör>/ref <klasör>/ts

# Seed'li, etiketli görsel karşılaştırma
npm run samples:phys
python -I scripts/compare_phys.py samples/reference samples/ts samples/compare --mask-label
```

Sonuç (3 durum: tezgah, mamul_orta %6/%10, mamul_yuksek %12/%20):

- Gürültüsüz: tüm piksellerde fark ≤ 1 gri seviye; Dw, Df, açıklık, örtme, sıkışma, kıvrım, gramaj
  referansla aynı (iki ondalıkta).
- Seed'li: yapı ve ışık aynı, gürültü farklı örneklenir; açıklık %0.3 içinde, diğer metrikler aynı.

Referans metrik çıktısı: `samples/reference/phys_metrics.txt` / `.json`.

## Kalibrasyon

`calibration/schema.json` bir numune kaydını tanımlar: örgü (`weave` veya `weavePreset`), slotlar +
diziler, tezgah sıklıkları ve `measured` (mamul sıklıklar, çekmeler, gramaj). `npm run calibrate`:

1. Ölçülen çekmelerle simüle sıklık ve gramajı hesaplar, sapma tablosunu basar.
2. `yarnDensity` (0.60–1.10) × `warpCrimpShare` (0.20–0.60) ızgara araması yapar; gramaj sapma
   kareleri toplamını en aza indiren değerleri ve en iyiye yakın bölgeyi önerir. `yarnDensity`
   yalnız kayıtta yoğunluğu verilmemiş slotlara uygulanır.

`calibration/samples/ornek-*.json` **örnek** kayıtlardır (uydurma ölçümler); gerçek numunelerle
değiştirin. İki parametreyi ayırmak için farklı örgü/iplik kombinasyonlarından en az 3 kayıt gerekir.

## Uygulama

- İplik paneli: çözgü/atkı için 4 slot kartı (numara + sistem, renk; gelişmiş: yoğunluk, büküm),
  rapor dizisi (çip tıkla = slot değiştir, sürükle = sırala, sağ tık = sil, ya da harflerle yaz).
- Kumaş paneli: tezgah sıklıkları, çekmeler, kıvrım payı.
- Görünüm: Tek / Tezgah | Mamul (aynı px/mm ve aynı mm penceresi), 5/10/20 mm alan, tekerlek zoom,
  sürükle-kaydır. Kaydırıcıda 0.5x önizleme, durunca tam render (Web Worker).
- Metrik çubuğu: mamul sıklıklar, açıklık, örtme, gramaj, kıvrımlar, sıkışma + uyarılar.
- Dışa aktarma: FabricSpec JSON, PNG (görünen pencere × 1/2/4).

## render-engine'i başka projeye (Tezgah) taşıma

`src/render-engine/` klasörünü olduğu gibi kopyalayın; dış bağımlılığı yoktur (`tsconfig.node.json`
motoru DOM tipleri olmadan derleyip Node'da çalıştırarak bunu doğrular).

```ts
import { simulatePhysical, computeMetrics, squeezeCheck } from './render-engine';

const res = simulatePhysical(spec, { x0Mm: 0, y0Mm: 0, widthMm: 10, heightMm: 8, pxPerMm: 80 }, { seed: 3 });
ctx.putImageData(new ImageData(res.image.data, res.image.width, res.image.height), 0, 0);
const metrics = computeMetrics(spec);            // rapor döngüsü ortalaması
const jam = squeezeCheck(spec);                  // "sıkıştı" kontrolü
// res.openPct: açıklık %
```

Worker: `new Worker(new URL('./render-engine/worker.ts', import.meta.url), { type: 'module' })`,
mesaj `{ kind: 'physical', id, spec, view, seed }` → `{ width, height, buffer, physical: { openPct, metrics, … } }`.
v1 için `{ id, input, params, region }` (kind verilmezse heightfield).
