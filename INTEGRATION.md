# Gerçekçi render modülünü bağlama (Tezgah PWA ve diğerleri)

`src/realistic/` örgü matrisinden deterministik, yakın plan "fotoğraf gerçekliğinde" kumaş görüntüsü üreten
bir WebGL2 modülüdür. React'e, uygulama state'ine veya bir store'a bağlı değildir: bir `<canvas>` ve bir
`FabricInput` alır. Bu belge, modülü başka bir uygulamaya (ör. Tezgah PWA) bağlamak için gerekenleri anlatır.

## 1. Klasörü taşıma

`src/realistic/` klasörünün tamamı kopyalanır; `adapters/` ve `dev/` hariç dış bağımlılığı yoktur.

| Dosya | Görevi |
| --- | --- |
| `index.ts` | Public API (yalnız buradan import edin) |
| `types.ts` | `FabricInput`, `ViewParams`, `RealisticRenderer`, `RenderStats` … |
| `renderer.ts`, `gl/` | WebGL2 geçiş zinciri (G-buffer → AO/gölge → ışık) |
| `geometry.ts`, `surface.ts`, `irregularity.ts`, `hash.ts` | Shader'ların CPU ikizleri (testler için) |
| `presets.ts`, `calibration.ts` | Kalibrasyon preset'leri (JSON) ve ortak ölçek yardımcıları |
| `perf.ts` | Otomatik kalite merdiveni |
| `adapters/fromSpec.ts` | Dokuma Simülatörü'ne özel; Tezgah'a taşınmaz |
| `dev/` | Snapshot sayfası (yalnız geliştirme) |

## 2. Dinamik import (lazy-load)

Modül ana bundle'a girmemeli; kullanıcı gerçekçi görünümü ilk açtığında yüklenir:

```ts
let mod: typeof import('./realistic') | null = null;

async function loadRealistic() {
  if (mod) return mod;
  try {
    mod = await import('./realistic');
  } catch {
    return null; // ağ / parça hatası → sessizce mevcut görünüm
  }
  return mod.isRealisticSupported() ? mod : null;
}
```

Yalnız tip kullanan dosyalarda `import type { FabricInput } from './realistic'` yazın; tip importları
bundle'a kod eklemez. Dokuma Simülatörü'nde gerçekçi katman (`src/app/RealisticLayer.tsx`) ve kalibrasyon
görünümü kendi parçalarıdır; ana bundle'da shader kodu yoktur (`vite build` sonrası kontrol edildi).

## 3. Tezgah adaptörü

Tezgah kendi desen modelini `FabricInput`'a çeviren tek bir saf fonksiyon sağlar:

```ts
import type { FabricInput } from './realistic';

export function toFabricInput(pattern: TezgahPattern): FabricInput;
```

`FabricInput` sözleşmesi (`src/realistic/types.ts`):

| Alan | Anlamı |
| --- | --- |
| `weave` | `{ warps, wefts, data: Uint8Array }`; `data[atkı · warps + çözgü]`, **1 = çözgü üstte**. **Atkı 0 ilk atkıdır ve kumaşın EN ALTINDADIR** (y yukarı artar). Tezgah satırları üstten alta tutuyorsa ters çevirin. |
| `warp`, `weft` | Rapor dizileri: `{ color: '#rrggbb', yarnType: number }`. Uzunluk örgüden bağımsızdır; modulo ile tekrar eder. |
| `yarnTypes` | `{ count, unit: 'Ne' \| 'Nm' \| 'Dtex' \| 'Denier' \| 'Tex', twist: 'S' \| 'Z', twistPerM?, luster: 'mat' \| 'yarimat' \| 'parlak', hairiness: 0..1, yarnDensity? }` |
| `density` | `{ warpPerCm, weftPerCm }`: tezgah ya da mamul ortalama sıklığı (hangisini göstermek istiyorsanız). |
| `seed`, `irregularity` | Deterministik düzensizlik: aynı girdi + tohum = birebir aynı piksel. |
| `crimpShare` | Krepajın çözgü payı β (varsayılan 0.4). |
| `positions`, `reed`, `shrink` | İleri iş için ayrılmış; şimdilik kullanılmaz (eşit aralık). |

Örnek iskelet (Tezgah'ın gerçek alan adlarıyla doldurulacak):

```ts
export function toFabricInput(p: TezgahPattern): FabricInput {
  const warps = p.weave[0].length;
  const wefts = p.weave.length;
  const data = new Uint8Array(warps * wefts);
  // Tezgah satır 0 = en üst ise: r' = wefts - 1 - r
  p.weave.forEach((row, r) => row.forEach((up, c) => (data[(wefts - 1 - r) * warps + c] = up ? 1 : 0)));
  const yarnTypes = p.yarns.map((y) => ({
    count: y.count,
    unit: y.unit,
    twist: y.twist ?? 'Z',
    twistPerM: y.twistPerM, // yoksa modül 500 tur/m varsayar
    luster: y.luster ?? 'yarimat',
    hairiness: y.hairiness ?? 0.2,
  }));
  return {
    weave: { warps, wefts, data },
    warp: p.warpOrder.map((k) => ({ color: p.colors[k], yarnType: p.warpYarn[k] })),
    weft: p.weftOrder.map((k) => ({ color: p.colors[k], yarnType: p.weftYarn[k] })),
    yarnTypes,
    density: { warpPerCm: p.warpPerCm, weftPerCm: p.weftPerCm },
    seed: p.id ? hashString(p.id) : 1, // aynı desen her açılışta aynı görünsün
  };
}
```

Renkler `#rrggbb` olmalıdır (`#abc` kabul edilmez; adaptörde genişletin). `validateInput(input)` hatalı
girdide Türkçe mesajla hata fırlatır; adaptör testlerinde kullanın.

## 4. Render

```ts
const r = mod.createRealisticRenderer(canvas, {
  measure: 'auto', // kare süresi ölçümü (otomatik kalite için)
  profile: 'desktop', // 'desktop' (düzenleme) | 'mobile' (salt görüntüleme) — bkz. bölüm 6a
  onContextLost: () => fallBackToExistingView(),
});

r.render(input, {
  pxPerCm: cssPxPerCm * devicePixelRatio, // CİHAZ pikseli / cm
  offsetCm: [x0, y0], // canvas'ın SOL ALT köşesinin kumaştaki yeri (cm, y yukarı)
  light: { azimuthDeg: 135, elevationDeg: 45 }, // azimut 0° = sağdan, 90° = üstten
  quality: 'medium', // 'low' | 'medium' | 'high'
  tuning: { aoStrength: 1, specularStrength: 1, specularWidth: 1, hairiness: 1, irregularity: 1, melange: 1 },
});
// İş bitince: r.dispose();
```

- Canvas'ın `width` / `height` (cihaz pikseli) değerini render'dan önce siz ayarlayın; renderer
  G-buffer'ını boyuta göre kendisi yeniden kurar.
- `input` nesnesi aynı kaldıkça dokular yeniden yüklenmez (kimliğe göre önbellek). Desen değişince yeni bir
  nesne verin; değişmeyince aynı nesneyi (ör. `useMemo`) verin.
- Render sürekli değildir: görünüm / girdi değiştiğinde bir kare çizin (`requestAnimationFrame` ile birleştirin).
- Fotoğrafla aynı ölçek / y yönü / kaydırma için `simView()` ve `photoRect()` (`calibration.ts`) kullanılabilir.

## 5. Destek kontrolü ve sessiz geri dönüş

Gerçekçi görünüm her zaman isteğe bağlıdır. Mevcut görünüm daima hazır kalır ve şu durumlarda kullanıcıya
hata göstermeden ona dönülür:

1. `import()` başarısız: çevrimdışı ya da parça bulunamadı.
2. `isRealisticSupported()` false: WebGL2 yok ya da kayan nokta render hedefi yok
   (`EXT_color_buffer_float`, yoksa `EXT_color_buffer_half_float`). Sonuç önbelleklenir; ilk çağrı geçici
   bir bağlam açar ve hemen kapatır.
3. `createRealisticRenderer` hata fırlatıyor (shader derleme vb.).
4. Bağlam kaybı: `onContextLost` geri çağrısı tetiklenir ya da `r.stats().contextLost` true olur.
   Bu durumda `render()` sessizce hiçbir şey yapmaz.

Dokuma Simülatörü'nde "Gerçekçi" düğmesi bu durumlarda kapanır ve devre dışı kalır; ipucu metni nedenini
söyler. Alttaki CPU render'ı hiç durmaz.

## 6. Kalite seçimi ve performans

`QUALITY_SAMPLES` (fix-v2): high = her şey açık (3 ölçek AO, gölge ≤ 48 adım, tüylülük); medium = tüylülük
kapalı, gölge adımları yarıya, 2 ölçek AO; low = gölge kapalı, tek ölçek AO.

Otomatik kalite (`perf.ts`, saf ve testli):

```ts
let auto = mod.initialAutoQuality();
// her kareden sonra (timer sonucu bir iki kare gecikmeli gelir):
const ms = r.stats().gpuMs;
if (ms !== null) auto = mod.stepAutoQuality(auto, ms); // bütçe 16 ms, histerezisli
const { quality, scale } = mod.PERF_LADDER[auto.level];
// scale < 1: canvas'ı css × dpr × scale boyutunda çizin, CSS ile büyütün; pxPerCm de aynı oranda.
```

Merdiven sırası: high → medium → low → low ×0.75 → low ×0.5 çözünürlük. Bütçe aşılınca bir basamak iner;
ortalama bütçenin yarısının altına düşünce bir basamak çıkar.

Ölçüm (`samples/realistic/fix-v2/perf.json`, masaüstü, AMD RX 7700 XT, 1024², GPU zamanlayıcısı):

| Profil | Gezinme karesi (medyan) | Döşeme pişirme (bir kez) |
| --- | --- | --- |
| masaüstü (her kalite) | ~0.88 ms | GPU 1–3 ms; yüksekte tüy CPU'da 20–260 ms (251 tellik bantlı döşemede ~59 bin lif) |
| mobil | ~0.02 ms (yalnız döşeme okunur) | 1–3 ms; yüksekte tüy dahil 20–260 ms |

Gezinme hedefi kare başına ≤ 4 ms (masaüstünde sağlanıyor).

**Telefon ölçümü yapılmadı.** Masaüstüne göre 30–60× daha yavaş bir orta telefonda 1024² kare kabaca
20–45 ms tahmin edilir (VARSAYIM). Kalite seviyeleri arasındaki fark küçüktür (~%20): maliyetin çoğu
G-buffer'daki komşu iplik adayları ile lif ve renk hash'lerindedir. Bu yüzden telefonda bütçeyi asıl
çözünürlük basamakları (×0.75 → %56, ×0.5 → %25 maliyet) sağlar. Telefonda doğrulamak için
`/dev/realistic-snapshots?phase=6` açılıp `perf.json` (method: 'timer' ya da 'sync') okunur.
`EXT_disjoint_timer_query_webgl2` çoğu mobil tarayıcıda yoktur; o zaman 'sync' yöntemi
(render + 1 piksel okuma) kullanılır.

## 6a. Önbellek profilleri (fix-v2)

Gölge, AO ve tüylülük her karede hesaplanmaz. Desen, iplik parametresi, ışık, kalite ya da ilgili ayar
(`aoStrength`, `irregularity`, `relief`, `hairiness`) değişince kumaş uzayında **bir döşeme** (`tile.ts`) için
bir kez pişirilir. Pan / zoom anahtara girmez; yalnız `mm mod döşeme` ile döşemeden okunur.

- **Döşeme:** `lcm(örgü raporu, renk / iplik dizisi)` iplik, en az 12 mm'ye katlanır (bantlı fixture:
  251 × 40 iplik = 62.75 × 12.5 mm). Kesintisiz tekrar için iplik başına rastgele değerler
  `indeks mod döşeme` ile alınır. İplik boyunca frekanslar döşeme boyuna tam periyot sığacak şekilde
  yuvarlanır (değişim ≤ %1–10). VARSAYIM: düzensizlik döşeme boyunda tekrar eder.
- **masaüstü** (`profile: 'desktop'`, düzenleme): geometri, kat, lif ve ışık her karede ekran
  çözünürlüğünde (keskin); ao / gölge / tüy döşemeden. Dokuma Simülatörü katmanı gezinirken (150 ms içinde
  ardışık görünüm değişimi) yarım çözünürlükte çizer, durunca tam kaliteye döner.
- **mobil** (`profile: 'mobile'`, salt görüntüleme): ışık sabitken tüm ışıklı sahne döşemeye bir kez
  pişirilir (en çok 2048 texel, ≤ 48 texel/mm); sonra her kare yalnız döşenir. Çok yakın zoomda keskinlik
  döşeme çözünürlüğüyle sınırlıdır. Pişirme sırasında kısa bir "Hazırlanıyor…" göstergesi yeterlidir.
  Dokuma Simülatörü dokunmatik cihazda (`pointer: coarse`) mobil profili kendisi seçer.
- `r.stats().tile`: döşeme boyu (mm), texel boyutu, pişirme süresi, lif sayısı. `bakeMs` yalnız pişirme
  yapılan karede dolu.

## 7. Yalnız yakın görünüm / büyüteç

Gerçekçi görünüm uzak ölçekte bilgi katmaz ve GPU'yu boşa harcar. Önerilen kullanım (Dokuma Simülatörü'nde
uygulanan):

- **Yakında** (≥ 100 px/mm): tüm kumaş paneli gerçekçi katmanla örtülür. Katman, mevcut görünümün tam
  üstünde aynı mm ↔ piksel eşlemesiyle durur.
- **Uzakta**: imleci izleyen 256 CSS px'lik yuvarlak büyüteç ×4 yakınlaştırır; büyütecin merkezi imlecin
  altındaki kumaş noktasıdır.
- Büyüteç gizlenince katman bağlı kalır, canvas yalnız gizlenir. Böylece WebGL bağlamı ve shader'lar her
  girişte yeniden kurulmaz.
- Dokunmatik cihazda imleç yoktur; büyüteç yerine yakınlaştırma eşiği (ya da uzun basma) kullanılması önerilir.

## 8. Kalibrasyon preset'leri

Dokuma Simülatörü'nün Kalibrasyon görünümü iplik tipi bazında JSON preset üretir:

```json
{ "version": 1, "name": "...", "yarn": { "count": 20, "unit": "Ne" },
  "surface": { "luster": "mat", "hairiness": 0.45, "twistPerM": 760 },
  "light": { "azimuthDeg": 120, "elevationDeg": 38 },
  "tuning": { "aoStrength": 1.3, "specularStrength": 0.7, "specularWidth": 1.4, "hairiness": 1.2, "irregularity": 1.5 },
  "quality": "high", "photoPxPerCm": 1180 }
```

Tezgah'ta uygulamak için:

```ts
const p = mod.parsePreset(text);
const idx = mod.matchingYarnTypes(input, p.yarn); // numara + birimle eşleşen iplik tipleri
input = mod.applySurfaces(input, Object.fromEntries(idx.map((i) => [i, p.surface])));
view = mod.applyPresetToView(view, p);
```

## 9. Bilinen sınırlar / varsayımlar

- İplikler eşit aralıklıdır. Tarak gruplaması ve mamuldeki bağlantıya bağlı aralık (yay modeli) henüz
  yoktur; `FabricInput.positions` (periyodik merkez tabloları) bunun için ayrılmıştır.
- Çap d = 0.0357·√(tex/ρ), ρ = 0.85 g/cm³. Kesit basıklığı, parlaklık sınıfı sayıları, varsayılan büküm
  (500 tur/m) ve düzensizlik varsayılanları (kalınlık %4, konum %5, ΔE 1.5) kalibrasyon bekleyen
  varsayımlardır.
- Half-float yedek hedefte (RGBA16F) iplik indeksi ±2048'e kadar kesindir. Daha uzak kaydırmalarda
  kimlik bozulabilir. `offsetCm`'i örgü + renk raporunun katlarına göre sarmak bunu önler, ama iplik başına
  düzensizlik indekse bağlı olduğundan sarılan bölgenin görünümü değişir.
- Tüy lifleri ana iş parçacığında üretilir. Büyük döşemede (251 tel) ~0.25 s tek seferlik takılma olur;
  gerekirse bir Worker'a taşınabilir.
- Determinizm aynı GPU / sürücü için piksel düzeyinde doğrulandı. Farklı GPU'larda kayan nokta farkları
  küçük piksel farkları üretebilir; bu yalnız bir masaüstü GPU'da denendi.
