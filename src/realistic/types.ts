/**
 * Gerçekçi render modülü — genel tipler.
 * Bu modül React'e, uygulama state'ine veya store'a bağlı değildir; yalnız bir canvas ve
 * aşağıdaki girdiyi alır. Tezgah PWA'ya olduğu gibi taşınabilir.
 */

export type CountUnit = 'Ne' | 'Nm' | 'Dtex' | 'Denier' | 'Tex';
export type Luster = 'mat' | 'yarimat' | 'parlak';

/** İplik tipi: numara, büküm, yüzey. */
export interface YarnType {
  count: number;
  unit: CountUnit;
  twist: 'S' | 'Z';
  /** Büküm sıklığı (tur/m). Verilmezse varsayılan kullanılır (Faz 3). */
  twistPerM?: number;
  luster: Luster;
  /** Tüylülük 0..1. */
  hairiness: number;
  /** İplik hacim yoğunluğu (g/cm³), çap hesabı için. Varsayılan 0.85. */
  yarnDensity?: number;
  /** Kat sayısı (kat oluğu aralığı = K / (kat · T)). Varsayılan 2. */
  plies?: number;
  /**
   * Yapı: 'spun' (varsayılan; eğrilmiş, kesit yuvarlağa yakın, basıklık yalnız sıkışmadan, en/boy ≤ 1.4) ya da
   * 'tape' (yassı bant: en/boy 3, kat oluğu yok), 'filament' (düz, bükümsüz / az bükümlü, tüysüz, sıkışmada
   * belirgin yassılaşır: en/boy ≤ 2), 'textured' (tekstüre: hacimli, mat, büküm görünmez, ince kıvrımlı lif
   * dokusu, yumuşak kenar).
   */
  structure?: 'spun' | 'tape' | 'filament' | 'textured';
}

/** Rapor dizisindeki bir iplik. */
export interface Thread {
  /** '#rrggbb' (sRGB). */
  color: string;
  /** `yarnTypes` dizisindeki indeks. */
  yarnType: number;
}

/**
 * Örgü matrisi: `data[atkı · warps + çözgü]`, 1 = çözgü üstte, 0 = atkı üstte.
 * Atkı 0 ilk atkıdır ve kumaşın en altındadır (y yukarı artar).
 */
export interface WeaveMatrix {
  warps: number;
  wefts: number;
  data: Uint8Array;
}

/** Periyodik iplik merkez tablosu (tarak / çekme sonrası konumlar için; Faz 1'de kullanılmaz). */
export interface PeriodicCenters {
  /** Bir periyottaki iplik merkezleri (mm, artan). */
  centersMm: Float32Array;
  /** Periyot uzunluğu (mm). */
  periodMm: number;
}

/** Düzensizlik ayarları (Faz 4). */
export interface Irregularity {
  thicknessPct?: number;
  colorDeltaE?: number;
  positionPct?: number;
}

export interface FabricInput {
  weave: WeaveMatrix;
  /** Çözgü rapor dizisi (örgü genişliğinden bağımsız uzunlukta, tekrar ederek uygulanır). */
  warp: Thread[];
  /** Atkı rapor dizisi. */
  weft: Thread[];
  yarnTypes: YarnType[];
  density: { warpPerCm: number; weftPerCm: number };
  /** Krepajın çözgüye düşen payı β (Peirce; varsayılan 0.4). Atkıya 1 − β düşer. */
  crimpShare?: number;
  /** Çekme (%, en / boy). Arayüz hazır, Faz 1'de uygulanmaz. */
  shrink?: { widthPct?: number; lengthPct?: number };
  /**
   * Tarak / çekme sonrası hazır merkez tabloları. Verilirse eşit aralığın yerine kullanılır
   * (ileri faz; Faz 1'de yok sayılır). Böylece tarak, çekme ve çoklu atkı yalnız veri olarak bağlanır.
   */
  positions?: { warp?: PeriodicCenters; weft?: PeriodicCenters };
  /** Tarak tanımı için yer tutucu (ileri faz). */
  reed?: unknown;
  /** Deterministik düzensizlik tohumu (Faz 4). */
  seed?: number;
  irregularity?: Irregularity;
}

export type Quality = 'low' | 'medium' | 'high';

/** Işık ve yüzey ayarları (Faz 3 / 5). */
export interface Tuning {
  /** Kesit basıklığı çarpanı: 0 = hep daire, 1 = varsayılan model (Faz 2). */
  flattening?: number;
  /** AO şiddeti 0..1+ (varsayılan 1). */
  aoStrength?: number;
  /** Speküler şiddet çarpanı (varsayılan 1). */
  specularStrength?: number;
  /** Speküler genişlik çarpanı: >1 daha geniş parlama (varsayılan 1). */
  specularWidth?: number;
  /** Tüylülük çarpanı (varsayılan 1). */
  hairiness?: number;
  irregularity?: number;
  /** Geometri parametre seti: 'v2' (varsayılan, fix-v2 prototip) ya da 'classic' (Faz 2; tutarlılık kontrolü). */
  model?: 'classic' | 'v2';
  /** v2 yüzey rölyefi çarpanı (kat, lif); 0 = yalnız taban geometri. Varsayılan 1. */
  relief?: number;
  /** Melanj (iplik boyunca renk dalgalanması) çarpanı; 1 = fix-v3 (≈ ±%6: lif ±%4.5, ince lif ±%1.5). */
  melange?: number;
  /**
   * Zemin (boşluk) görünümü (fix-v3): 'darkgray' (varsayılan, doğrusal ≈ 0.02), 'black', 'backlight' (arkadan
   * ışık: boşluklar aydınlık, iplikler koyu siluet + hafif kenar ışığı; perde ışık geçirgenliği).
   */
  background?: 'darkgray' | 'black' | 'backlight' | 'light';
  /** Kontakt gölge şiddeti (üst iplik → alttaki iplik; 0.4·d genişlik). 0 = kapalı, varsayılan 1. */
  contactShadow?: number;
  /**
   * Kumaş ölçeğinde doğal düzensizlik çarpanı (barre ±%2.5, çözgü sapması, atkı yayı; rapordan bağımsız uzun periyot).
   * 0 = kapalı, varsayılan 1. Seed'e bağlı, deterministik.
   */
  fabricIrregularity?: number;
  /** İplik yayılması çarpanı (Durak 2-E; 0 = sert yuvarlak kesit, 1 = varsayılan tip modeli). */
  spread?: number;
  /** Ton eşleme beyaz noktası (pozlama sonrası doğrusal; küçük = daha erken sıkıştırır). Varsayılan 2. */
  whitePoint?: number;
}

export interface ViewParams {
  /** Ölçek: piksel / cm. */
  pxPerCm: number;
  /** Canvas'ın sol alt köşesinin kumaştaki konumu (cm). */
  offsetCm: [number, number];
  light: { azimuthDeg: number; elevationDeg: number };
  quality: Quality;
  tuning?: Tuning;
  /**
   * Bakış mesafesi (viewDistance.ts): bir ÖLÇEK değil, kumaş uzayında algısal FİLTRE. 'eye' Göz 40 cm (çap 0.116 mm),
   * 'far' Uzak 2 m (0.582 mm), 'loupe' (varsayılan) filtre yok. Zoom (pxPerCm) her modda serbest.
   */
  distance?: 'eye' | 'far' | 'loupe';
  /**
   * Etkin gezinme (pan / zoom) sürüyor: filtreli yolda mevcut pişirme yoğunluk kovası değişse de yeniden pişirilmez
   * (mip'ten okunur); Lup'ta da keskin yol yerine filtreli yol kullanılır. Durunca false verin.
   */
  navigating?: boolean;
}

/** Son karelerin süre ölçümü (Faz 6). */
export interface RenderStats {
  /** Son ölçülen kare süresi (ms); henüz yoksa null. */
  gpuMs: number | null;
  /**
   * 'timer': EXT_disjoint_timer_query_webgl2 ile gerçek GPU süresi (bir iki kare gecikmeli).
   * 'sync' : eklenti yoksa render + 1 piksel okuma (GPU'yu bekletir; kaba, biraz pahalı).
   * 'none' : ölçüm kapalı.
   */
  method: 'timer' | 'sync' | 'none';
  /** WebGL bağlamı kaybedildi mi (render artık sessizce hiçbir şey yapmaz). */
  contextLost: boolean;
  /** Son render'da döşeme pişirildiyse süresi (ms, CPU duvar saati); önbellekten okunduysa null. */
  bakeMs?: number | null;
  /** Geçerli döşeme önbelleği. */
  tile?: { mm: [number, number]; texels: [number, number]; ms: number; hairStrokes: number; hairMs: number } | null;
}

export interface RealisticRenderer {
  /** Bağlam kaybedilmişse sessizce hiçbir şey yapmaz (çağıran `stats().contextLost` ile CPU'ya döner). */
  render(input: FabricInput, view: ViewParams): void;
  stats(): RenderStats;
  dispose(): void;
  /** Hata ayıklama / snapshot: son karenin RGBA pikselleri (alttan yukarı satırlar, GL düzeni). */
  readPixels(): Uint8Array;
  /** Hata ayıklama: G-buffer (gb0 = yükseklik, u, v, kimlik; gb1 = normal.xy, kaplama, a). GL düzeni. */
  readGBuffer(): { width: number; height: number; gb0: Float32Array; gb1: Float32Array; gb3?: Float32Array };
}

export interface RendererOptions {
  /** toDataURL / readPixels için çizim tamponunu koru (snapshot). Varsayılan false. */
  preserveDrawingBuffer?: boolean;
  /** Görünüm: 'flat' (Faz 1 düz renk), 'preview' (Faz 2 G-buffer + Lambert), 'lit' (Faz 3, varsayılan). */
  debugView?: 'flat' | 'preview' | 'lit';
  /** Kare süresi ölçümü: 'auto' = timer varsa timer, yoksa sync. Varsayılan 'none'. */
  measure?: 'auto' | 'timer' | 'sync' | 'none';
  /** WebGL bağlamı kaybedilince çağrılır (ör. sekme arka planda, sürücü sıfırlandı). */
  onContextLost?: () => void;
  /**
   * Önbellek profili (fix-v2 adım 2). 'desktop' (varsayılan): ao / gölge / tüy döşemeye pişirilir, geometri
   * ve ışık her karede ekran çözünürlüğünde. 'mobile': tüm ışıklı sahne döşemeye bir kez pişirilir, her
   * karede yalnız döşenir (salt görüntüleme; çok yakında döşeme çözünürlüğü kadar keskin).
   */
  profile?: 'desktop' | 'mobile';
  /** Hata ayıklama / ölçüm: katmanlı çizimi kapat (yalnız üst iplik, kenar yumuşatma yok). Varsayılan false. */
  singleLayer?: boolean;
  /**
   * Hata ayıklama / ölçüm (şerit nedenlerini ayırmak için; uygulama kullanmaz): filtreli yolda iplik başına sapmayı
   * eskisi gibi döşemeye pişir (`bakeVariation`, döşeme periyotlu) ya da pişirme yoğunluğunu zorla (`density`).
   */
  debugFilter?: { bakeVariation?: boolean; density?: number };
}
