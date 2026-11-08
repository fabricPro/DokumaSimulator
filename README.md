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
npm run samples:shrink # çekme dağılımı örnekleri → samples/shrink/
npm run samples:reed   # tarak örnekleri (tarak şeridi + Tezgah | Mamul) → samples/reed/
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
| `src/render-engine/reed/` | Tarak: birim dönüşümü, taraklama raporu sözdizimi, türetilen değerler, `ReedPositionGenerator` |
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
| `interlacing.ts` | komşu çift bağlantı oranı `w_k` (çözgü ve atkı aralıkları), karşı iplik çapıyla ağırlıklı `t_k`; Σ w_k = Ashenhurst I |
| `positions.ts` | `PositionGenerator` arayüzü; `UniformPositionGenerator` (taraksız tezgah), `reedLayout` / tarak (diş/cm + diş başına tel, ör. 3-0-0, 2-2-3-0), `PeriodicPositionGenerator` |
| `shrinkage.ts` | ortalama mamul sıklık: çözgü = tezgah çözgü / (1 − atkı çekmesi); atkı = tezgah atkı / (1 − çözgü çekmesi) |
| `shrinkDistribution.ts` | çekmenin aralıklara dağılımı (yay modeli, aşağıda), ulaşılabilirlik ve maksimum çekme, tezgah ↔ mamul eşlemesi |
| `squeeze.ts` | Ashenhurst `(10/d)·E/(E+I)` (yanal bağlantı), kıvrım için iplik boyunca bağlantı |
| `metrics.ts` | mamul sıklık, örtme `1−(1−c1)(1−c2)`, Peirce kıvrımı `8/3·(h/p)²·I/E`, kıvrımlı gramaj, sıkışma oranı; konumlardan en büyük gözenek, ortalama grup genişliği, analitik açıklık |
| `simulate.ts` | mm koordinatlı heightfield: piksel → en yakın iplik (ikili arama), çapraz iplik aralığında dalga, iplik başına yarıçap / racetrack kesit / büküm (1.5r), yarıçapa göre ölçeklenen gürültü ve gölge, beyaz patlaması düzeltmesi, 1 mm ölçek çubuğu |

### Çekme dağılımı (v2.1)

Çekme iplikleri eşit sıklaştırmaz: aynı hareketi yapan komşu iplikler toplanır, ters bağlanan komşular
ayrık kalır (yalancı lino / sepet görünümü). Model:

- **Bağlantı oranı** `w_k` = k ve k+1 ipliklerinin farklı durumda olduğu karşı ipliklerin oranı.
  Bezayağında hepsi 1, 2/2 dimide hepsi 0.5, panamada çift içinde 0 ve çiftler arasında 1. 3×3 yalancı
  linoda grup içinde 1/3, grup sınırında 1.
- **Yay modeli:** her komşu aralık bir yaydır. Tezgah aralığı `g0`, en küçük aralık `m = c·(r₁+r₂) + w·d_karşı`,
  sertlik `k = 1 + (ρ−1)·w`. Hedef genişlik `W = W0·(1 − çekme)`; açık 1/k oranında dağıtılır, m'ye
  dayanan aralık sabitlenir, kalan yeniden dağıtılır (su doldurma). Serbest bir "gruplaşma" sürgüsü yoktur.
- Tüm aralıkları eşit bağlanan örgüler (bezayağı, dimi) her çekmede eşit aralıklı kalır. Panama ikili,
  yalancı lino üçlü gruplaşır. Taraklama (3-0-0) gruplaşmayı tezgahta başlatır.
- Σm > W ise çekme ulaşılamaz: uyarı ve ulaşılabilen maksimum çekme gösterilir.
- **Racetrack kesit** (Love 1954): sıkışan iplik komşusuna değdiği taraftan düzleşir, kesit alanı korunur
  (`πa² + 4a(b−a) = πr²`). O atkıda komşusu da aynı durumdaysa tam, değilse yarı yassılır.
- c (0.85) ve ρ (8) varsayılandır ve kalibrasyonla ayarlanır. İplik boyunca konum sabittir; yanal bükülme v3'e kaldı.

**Kaynaklar:** Ashenhurst (maksimum sıklık); Love (1954) racetrack kesit; Seyam & El-Shiekh (Ashenhurst +
racetrack sıkılık faktörü); yalancı lino: US10023981B2, Grosicki — *Watson's Textile Design and Colour*,
Hayavadana — *Woven Fabric Structure Design* ("Mock leno and distorted effects"), INFLIBNET e-PG
Pathshala "Fancy weaves" (3×3 birimin ters çevrilmesiyle kurulan 6×6 rapor; grup çözgüleri aynı dişe taraklanır).

**Ashenhurst düzeltmesi:** çözgü sıklığı için E = rapordaki çözgü sayısı ve I = bir atkı boyunca atkının
çözgüler arasından geçiş sayısı (Σ w_k). `reference/weave_phys.py` eksenleri ters sayıyordu; bu yüzden
sıkışma oranı referanstan bilinçli olarak farklıdır. Kıvrımda iplik boyunca bağlantı kullanılır, o değişmedi.

**Uyarılar:** Ashenhurst oranı kesin sınır değildir — %100 üstü sarı, %115 üstü kırmızı uyarı.
Asıl hata durumları: tezgahta komşu aralığın 0.55·(r+r)'nin altında olması (**sıkıştı**, ör. tarak
zorlaması) ve **ulaşılamaz çekme**. Kıvrım payı 1.00 / 0.00'da "kıvrım sıfır" uyarısı verilir.

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
  warpCrimpShare,                             // 0.4
  reed?: { densityPerCm, denting: number[] }, // tarak (opsiyonel)
  relax?: { c?, rho? }                        // çekme yay modeli (0.85 / 8)
}
YarnSlot = { name, count, system: 'Ne'|'Nm'|'Dtex'|'Denier'|'Tex', color, yarnDensity?, twist: 'S'|'Z' }
```

Eski JSON'lar (renk dizisi + tek iplik) otomatik çevrilir: her renk bir slot, dizi en kısa periyoduna
indirgenir. 4'ten fazla renk varsa en sık 4 renk slot olur, diğerleri en yakın slota birleştirilir ve
uyarı gösterilir. WIF içe aktarma da aynı kuralı kullanır. Referansın çizdiği büküm yönü S'dir; Z kesit
içi terimi ters çevirir.

## Tarak (`src/render-engine/reed/`)

```ts
ReedSpec {
  reedNumber; reedUnit?: 'diş/cm' | 'diş/10cm' | 'diş/inç';
  wireRatio?: 0.30;                 // diş teli / adım; açıklık = p·(1 − wireRatio)
  dentingReport: number[];          // diş başına tel, 0 = boş diş
  reedWidthCm?; startOffset?
}
```

- **Birim:** her şey diş/cm'ye çevrilir. 20 diş/cm = 200 diş/10cm = 50.8 diş/inç; diş adımı p = 10 / diş/cm mm.
- **Rapor sözdizimi:** `3-0`, `3-3-3-0-0`, `3x4, 0x2`, `(2-2-3)x2, 0` (iç içe grup olabilir; `×` ve `*` de kabul edilir).
  Ayırıcılar `-` `,` `;`; boşluk ayırıcı değildir. Hatalı girişte tahmin yürütülmez, karakter konumlu Türkçe hata verilir.
- **Türetilen değerler:** ortalama tel/diş, tezgah çözgü sıklığı (diş/cm × ortalama tel/diş), rapor genişliği. Tarak eni
  verildiyse toplam diş, toplam tel, tam rapor sayısı ve eksik rapor uyarısı. Tarak varken sıklık taraktan türetilir;
  elle girilen değer devre dışı kalır ve tutmazsa uyarı verilir.
- **Tezgah konumları:** çözgüler sırayla dolu dişlere dağılır (`DrawingInPlan` ile ayrı tahar planı ileride bağlanabilir).
  Bir dişteki teller açıklık içinde ortalanır: çap toplamı açıklıktan küçükse n+1 eşit boşlukla yayılır, büyükse
  birbirine değerek dizilip açıklıktan taşar (racetrack kesit devreye girer). Σ çap > açıklık / 0.6 ise
  "N. dişe bu kadar tel sığmıyor" uyarısı. Boş diş komşu teller arasında bir adımlık boşluk bırakır. Atkı yönünde tarak yoktur.
- **Çekme:** tezgah aralıkları taraktan gelir, yay modeli aynen uygulanır.
- **Görüntü:** panelin üstünde kumaşla aynı px/mm'de tarak şeridi var. Diş telleri koyu, teller çözgü renginde nokta,
  boş dişler taralı; diş adımı etiketi gösterilir. Mamulde tezgah → mamul bağlantı çizgileri açılıp kapatılabilir.
  Rapor tekrar kartı taraklama, çözgü renk/iplik ve örgü raporlarını ve bunların EKOK'unu (tel ve mm) gösterir.
- **Tarak paneli:** numara + birim, tarak eni; gelişmiş: tel oranı, başlangıç dişi. Metin girişi ve tıklanabilir diş
  şeridi iki yönlü senkrondur (tık +1, sağ tık / uzun basma −1). Şablonlar: 2'li düz, 3-0, 3-3-0, 4-0-0, 2-2-3-0.
- **Eski biçim:** `{ densityPerCm, denting }` biçimli tarak alanı okunurken yeni biçime çevrilir.

`npm run samples:reed` dört kombinasyonu üretir, hepsi 12 tel/cm ve 300 den ile, %0 / %8 / %15 çekmede:
bezayağı + 2'li düz, panama + 2'li düz, yalancı lino + 3-0-0, yalancı lino + 1'li düz.
Tezgahta her çözgü merkezinin kendi diş açıklığında olduğu script içinde de kontrol edilir.

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

- v2.1'de sıkı kontrol yalnız **tezgah** durumundadır: gürültüsüz render tüm piksellerde ≤ 1 gri seviye,
  Dw, Df, açıklık, örtme, kıvrım ve gramaj referansla aynı.
- Mamul durumları ve sıkışma oranı yeni çekme modeli ile Ashenhurst düzeltmesi yüzünden bilinçli olarak
  farklıdır; karşılaştırma tablosu bunları "B" (beklenen fark) olarak işaretler.

### Çekme örnekleri

```bash
npm run samples:shrink
```

"Aynı iplikler" modunda Tezgah | Mamul görüntüleri üretir: bezayağı, panama, 3×3 yalancı lino (taraksız ve
3-0-0 taraklı) ve `samples/input/kullanici-6x6.json`. Her biri %0 / %8 / %15 çekmede, 300 den iplik ve
13/13 tel/cm ile. Çıktı `samples/shrink/` altına gider: `<örgü>_<çekme>.png`, `<örgü>_ozet.png` ve `metrics.json`.

Referans metrik çıktısı: `samples/reference/phys_metrics.txt` / `.json`.

## Kalibrasyon

`calibration/schema.json` bir numune kaydını tanımlar:

- örgü (`weave` veya `weavePreset`), slotlar ve diziler, tezgah sıklıkları, opsiyonel `reed` ve `relax`,
  opsiyonel `photo` (`path`, `pxPerMm`),
- `measured`: mamul sıklıklar, çekmeler, gramaj, açıklık %, ortalama grup genişliği, en büyük gözenek (mm).

`npm run calibrate`:

1. Ölçülen çekmelerle simüle sıklık, gramaj, açıklık, grup genişliği ve gözeneği hesaplar ve sapma tablosunu basar.
2. `yarnDensity` × `warpCrimpShare` × `ρ` × `c` ızgara araması yapar. Hedef, gramaj + mamul sıklıklar +
   açıklık % göreli sapma karelerinin toplamıdır. Izgarada açıklık konumlardan analitik izdüşümle
   hesaplanır; en iyi aday için render'lı açıklık da gösterilir (ikisi örnek kayıtlarda %0.5 içinde).
3. En iyi değeri, en iyiye yakın bölgeyi ve aralık sınırında kalan parametreleri raporlar.

`calibration/samples/ornek-*.json` **örnek** kayıtlardır (uydurma ölçümler); gerçek numunelerle değiştirin.
4 parametreyi ayırmak için farklı örgü/iplik/tarak kombinasyonlarından en az 4 kayıt gerekir.

## Uygulama

- İplik paneli: çözgü/atkı için 4 slot kartı (numara + sistem, renk; gelişmiş: yoğunluk, büküm),
  rapor dizisi (çip tıkla = slot değiştir, sürükle = sırala, sağ tık = sil, ya da harflerle yaz).
- Kumaş paneli: tezgah sıklıkları; tarak (diş/cm, taraklama "3-0-0", diş şeridi, türetilen sıklık ve
  tutarsızlık uyarısı); çekmeler; kıvrım payı; gelişmiş çekme modeli (c, ρ).
- Görünüm: Tek / Tezgah | Mamul. Karşılaştırmada iki seçenek var:
  - **Aynı iplikler** (varsayılan): mamul paneli tezgah penceresindeki aynı iplikleri daralmış haliyle gösterir.
  - **Aynı alan**: iki panel aynı mm penceresini gösterir.
- Görünüm ayarları: 5/10/20 mm alan, tekerlek zoom, sürükle-kaydır. "Bağlantı şeritleri" w_k'yı panel
  kenarlarında gösterir (yeşil 0 → kırmızı 1). Kaydırıcıda 0.5x önizleme, durunca tam render (Web Worker).
- Metrik çubuğu: mamul sıklıklar, açıklık, en büyük gözenek, grup genişliği, örtme, gramaj, kıvrımlar,
  sıkışma ve uyarılar.
- Dışa aktarma: FabricSpec JSON, PNG (görünen pencere × 1/2/4).

## render-engine'i başka projeye (Tezgah) taşıma

`src/render-engine/` klasörünü olduğu gibi kopyalayın; dış bağımlılığı yoktur (`tsconfig.node.json`
motoru DOM tipleri olmadan derleyip Node'da çalıştırarak bunu doğrular).

```ts
import { simulatePhysical, computeMetrics, structureMetrics } from './render-engine';

const res = simulatePhysical(spec, { x0Mm: 0, y0Mm: 0, widthMm: 10, heightMm: 8, pxPerMm: 80 }, { seed: 3 });
ctx.putImageData(new ImageData(res.image.data, res.image.width, res.image.height), 0, 0);
const metrics = computeMetrics(spec);            // rapor döngüsü ortalaması
const st = structureMetrics(spec);               // gözenek, grup, ulaşılabilirlik, uyarılar
// res.openPct: açıklık %
```

Worker: `new Worker(new URL('./render-engine/worker.ts', import.meta.url), { type: 'module' })`,
mesaj `{ kind: 'physical', id, spec, view, seed }` → `{ width, height, buffer, physical: { openPct, metrics, … } }`.
v1 için `{ id, input, params, region }` (kind verilmezse heightfield).
