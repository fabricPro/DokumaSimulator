# Dokuma Simülatörü

Armür örgü matrisi ve renk raporlarından, heightfield (yükseklik haritası) yöntemiyle 3B hissi veren
kumaş görüntüsü üretir. Render algoritması `reference/weave_render.py` referans implementasyonunun
birebir TypeScript karşılığıdır.

## Çalıştırma

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest: geometri, dalga/kesit fonksiyonları, gauss, WIF, JSON
npm run build      # tsc + vite build
npm run samples    # TS motoruyla 5 örneği samples/ts/ altına render eder (Node, DOM yok)
```

## Klasörler

| Yol | İçerik |
| --- | --- |
| `src/render-engine/` | **Taşınabilir render motoru** (React/DOM bağımlılığı yok) |
| `src/importers/` | WIF, FabricSpec JSON, `.atki.json` (yalnız arayüz, TODO) |
| `src/presets/weaves.ts` | Bezayağı, 2/2 dimi, 3/1 dimi, 5'li saten, panama, armür motifi (referansla aynı tanımlar) |
| `src/app/` | İnce React kabuğu: editör, kontroller, görünüm, Worker istemcisi |
| `reference/` | Python referans implementasyonu |
| `samples/reference/` | Referansın çıktıları (`python reference/weave_render.py all`) |
| `samples/ts/` | TS motorunun aynı 5 örgü + aynı parametrelerle çıktıları |
| `samples/compare/` | Yan yana karşılaştırma (sol: Python, sağ: TS) |
| `scripts/` | Örnek üretimi, referans harness'ı, karşılaştırma |

## Render algoritması (heightfield)

`src/render-engine/heightfield/render.ts`, referanstaki sırayla ayrı geçişlerden oluşur. Her geçiş
ileride bir WebGL fragment shader geçişine karşılık gelecek şekilde ayrıktır:

1. **fieldsPass** — piksel başına çözgü/atkı: wobble'lı merkez, yarım daire kesit (0.6r),
   smoothstep örgü dalgası (±0.85r), 2 katlı büküm kabartması, lif gürültüsü; yüksek olan iplik görünür.
2. **lightingPass** — 0.7σ yumuşatma, `np.gradient` eşdeğeri normal, diffuse + specular (üs 18).
3. **shadowPass** — ışık yönünde 13 adımlık ekran uzayı gölge, 1.2σ bulanıklık.
4. **occlusionPass** — yükseklik AO + 4σ cavity.
5. **compositePass** — renk × ışık, arka plan, 1/1.1 gama.

Gauss bulanıklıkları scipy `gaussian_filter` ile uyumludur (ayrılabilir 1D çekirdek, truncate 4,
`reflect` kenar). Lif gürültüsü seed başına bir kez üretilen 512×512 döşenebilir dokulardan okunur.

### Parametreler (`HeightfieldParams`)

| Ad | Varsayılan | Anlam |
| --- | --- | --- |
| `cell` | 36 | piksel / iplik (uygulamada zoom) |
| `yarnRatio` | 0.74 | iplik kalınlığı (ileride numara + sıklıktan hesaplanacak) |
| `plyPitch` | 0.55 | büküm adımı (hücre cinsinden) |
| `twistAngle` | 0.65 | büküm açısı katsayısı |
| `wobble` | 1.6 | iplik merkezi dalgalanması (px) |
| `seed` | 3 | gürültü tohumu |

### Referansla doğrulama

```bash
# 1) Gürültüsüz karşılaştırma: rastgelelik sabitlenir (uniform → aralık ortası, normal → 0)
python -I scripts/reference_harness.py <klasör>/ref_flat
npx tsx scripts/render-samples.ts flat <klasör>/ts_flat
python -I scripts/compare.py <klasör>/ref_flat <klasör>/ts_flat
# Sonuç: 5 örgünün hepsinde ortalama fark 0.000, en büyük fark 1 gri seviye.

# 2) Seed'li görsel karşılaştırma
npm run samples
python -I scripts/compare.py samples/reference samples/ts samples/compare
```

Seed'li modda piksel farkı vardır çünkü numpy PCG64 yerine deterministik hash/mulberry32 kullanılır
(wobble fazları, ton varyasyonu, lif gürültüsü farklı örneklenir); yapı, ışık, gölge birebir aynıdır.

## Uygulama

- **Performans:** hesap Web Worker'da (`src/render-engine/worker.ts`). Her değişiklikte önce 0.5x
  önizleme, 220 ms durunca tam çözünürlük. Yalnız görünür bölge (+24 px kenar payı) hesaplanır,
  böylece 200×200 × 4×4 tekrar (800×800 iplik) zoom'dan bağımsız olarak çizilir.
- **Görünüm:** fare tekerleği (imleç merkezli zoom = `cell`), sürükle-kaydır, ekrana sığdır.
- **İçe aktarma:** `.wif` (THREADING + TIEUP + TREADLING veya LIFTPLAN, Rising Shed, COLOR TABLE/Range),
  FabricSpec `.json`. `.atki.json` için yalnız `AtkiJsonImporter` arayüzü var (TODO: örnek dosya bekleniyor).
- **Dışa aktarma:** FabricSpec JSON; PNG 1x/2x/4x (tüm kumaş, cell × çarpan, en fazla 64 MP).

## render-engine'i başka projeye (Tezgah) taşıma

`src/render-engine/` klasörünü olduğu gibi kopyalayın. Dış bağımlılığı yoktur; React, DOM veya
uygulama state'i kullanmaz (bunu `tsconfig.node.json` doğrular: `scripts/` motoru DOM tipleri
olmadan derler ve Node'da çalıştırır).

```ts
import { renderHeightfield, weaveInputFromSpec, DEFAULT_PARAMS } from './render-engine';

const input = weaveInputFromSpec(spec);                  // FabricSpec → WeaveInput
const img = renderHeightfield(input, { ...DEFAULT_PARAMS, cell: 24 }, {
  region: { x: 0, y: 0, width: 800, height: 600 },        // opsiyonel: yalnız görünen bölge
});
const id = new ImageData(img.data, img.width, img.height);
ctx.putImageData(id, 0, 0);
```

Worker ile (Vite):

```ts
const worker = new Worker(new URL('./render-engine/worker.ts', import.meta.url), { type: 'module' });
worker.postMessage({ id: 1, input, params, region });     // RenderJob
worker.onmessage = (e) => { /* RenderJobResult: { width, height, buffer (RGBA) } */ };
```

`FabricSpec` → render eşlemesi: `nWarp = weave genişliği × repeatX`, `nWeft = weave yüksekliği × repeatY`;
renk raporları iplik indeksine döngüsel uygulanır; 0. atkı görüntünün en altındadır. İplik numarası,
sıklık ve lif yoğunluğu `geometry.ts`'te tex/çap/aralık olarak hesaplanır; şu an render'a bağlı değildir
(`yarnRatio` elle ayarlanır), ileride `yarnRatio = çap / aralık` olarak bağlanacak.
