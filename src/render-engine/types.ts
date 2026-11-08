/**
 * Render motorunun genel tipleri.
 * Bu modül React'e, DOM'a veya global state'e bağımlı değildir.
 */

export type YarnSystem = 'Ne' | 'Nm' | 'Dtex' | 'Denier';

export interface YarnSpec {
  /** İplik numarası, `system` biriminde. */
  count: number;
  system: YarnSystem;
  /** Lif yoğunluğu (g/cm³). Varsayılan 1.38 (polyester). */
  fiberDensity?: number;
}

export interface FabricSpec {
  /** true = çözgü üstte. Satır = atkı (0. atkı en altta çizilir), sütun = çözgü. */
  weave: boolean[][];
  /** Çözgü renk raporu; tekrar ederek uygulanır. */
  warpColors: string[];
  /** Atkı renk raporu; tekrar ederek uygulanır. 0. eleman 0. (en alttaki) atkıya gelir. */
  weftColors: string[];
  warpYarn: YarnSpec;
  weftYarn: YarnSpec;
  /** Çözgü sıklığı, tel/cm. */
  warpDensity: number;
  /** Atkı sıklığı, tel/cm. */
  weftDensity: number;
  /** Raporun yatayda kaç kez tekrarlanacağı. */
  repeatX: number;
  /** Raporun dikeyde kaç kez tekrarlanacağı. */
  repeatY: number;
}

/**
 * Heightfield render parametreleri (reference/weave_render.py `render()` imzasıyla birebir).
 */
export interface HeightfieldParams {
  /** Piksel / iplik (zoom). */
  cell: number;
  /** İplik çapı / iplik aralığı. */
  yarnRatio: number;
  /** Büküm adımı, hücre cinsinden. */
  plyPitch: number;
  /** Büküm açısı katsayısı. */
  twistAngle: number;
  /** İplik merkezlerinin sinüs dalgalanması (px). */
  wobble: number;
  /** Gürültü tohumu. */
  seed: number;
}

export const DEFAULT_PARAMS: HeightfieldParams = {
  cell: 36,
  yarnRatio: 0.74,
  plyPitch: 0.55,
  twistAngle: 0.65,
  wobble: 1.6,
  seed: 3,
};

/** Render girdisi: örgü + renk raporları + toplam iplik sayıları. */
export interface WeaveInput {
  weave: boolean[][];
  warpColors: string[];
  weftColors: string[];
  /** Toplam çözgü sayısı (görüntü genişliği = nWarp · cell). */
  nWarp: number;
  /** Toplam atkı sayısı (görüntü yüksekliği = nWeft · cell). */
  nWeft: number;
}

/** Tam kumaş görüntüsü içinde, üstten-soldan piksel cinsinden bölge. */
export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** RGBA8 piksel tamponu (ImageData ile uyumlu). */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/**
 * Rastgelelik kaynağı. Varsayılan: seed'e bağlı deterministik hash + önbellekli gürültü dokuları.
 * Testlerde referansla piksel karşılaştırması için sabit değerler enjekte edilebilir.
 */
export interface RandomSource {
  /** Çözgü i'nin wobble fazı, [0, 2π). */
  warpPhase(i: number): number;
  /** Atkı j'nin wobble fazı, [0, 2π). */
  weftPhase(j: number): number;
  /** Çözgü i'nin ton çarpanı, 1 ± 0.06. */
  warpTone(i: number): number;
  /** Atkı j'nin ton çarpanı, 1 ± 0.06. */
  weftTone(j: number): number;
  /** Çözgü lif gürültüsü (std ≈ 1), tam görüntü pikseli (x, y) için. */
  warpFiber(x: number, y: number): number;
  /** Atkı lif gürültüsü (std ≈ 1). */
  weftFiber(x: number, y: number): number;
}
