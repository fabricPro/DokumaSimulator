import type { ReedSpec } from './reed/types';

/**
 * Render motorunun genel tipleri.
 * Bu modül React'e, DOM'a veya global state'e bağımlı değildir.
 */

export type YarnSystem = 'Ne' | 'Nm' | 'Dtex' | 'Denier' | 'Tex';

export interface YarnSpec {
  /** İplik numarası, `system` biriminde. */
  count: number;
  system: YarnSystem;
  /** Lif yoğunluğu (g/cm³). Varsayılan 1.38 (polyester). */
  fiberDensity?: number;
}

/* ------------------------------------------------------------------ */
/* FabricSpec v2 — fiziksel ölçekli model                              */
/* ------------------------------------------------------------------ */

export type SlotName = 'A' | 'B' | 'C' | 'D';
export const SLOT_NAMES: SlotName[] = ['A', 'B', 'C', 'D'];
export const MAX_SLOTS = 4;

export interface YarnSlot {
  name: SlotName;
  count: number;
  system: YarnSystem;
  color: string;
  /** İplik hacim yoğunluğu (g/cm³). Varsayılan 0.85 (filament ~1.0, spun ~0.8). */
  yarnDensity?: number;
  /** Büküm yönü; referansın çizdiği yön S'dir. */
  twist: 'S' | 'Z';
}

export interface FabricSpec {
  version: 2;
  /** true = çözgü üstte. Satır = atkı (0. atkı en altta), sütun = çözgü. */
  weave: boolean[][];
  warpSlots: YarnSlot[];
  weftSlots: YarnSlot[];
  /** Slot indeks raporu (ör. [0,0,1,0,2,3] = A A B A C D); tekrar ederek uygulanır. */
  warpSequence: number[];
  weftSequence: number[];
  /** Tezgah çözgü sıklığı, tel/cm. */
  warpDensityLoom: number;
  /** Tezgah atkı sıklığı, atkı/cm. */
  weftDensityLoom: number;
  /** Çözgü çekmesi % (boy kısalır → atkı sıklığı artar). */
  warpShrinkPct: number;
  /** Atkı çekmesi % (en daralır → çözgü sıklığı artar). */
  weftShrinkPct: number;
  /** Kıvrımın çözgüye düşen payı (Peirce h1/(h1+h2)), varsayılan 0.4. */
  warpCrimpShare: number;
  /** Tarak (opsiyonel). Verilirse tezgah çözgü konumları ve sıklığı taraktan türetilir. */
  reed?: ReedSpec;
  /** Çekme yay modeli: c = racetrack sıkışma katsayısı (0.85), rho = bağlantılı/bağlantısız sertlik oranı (8). */
  relax?: { c?: number; rho?: number };
}

/** v1 FabricSpec (eski JSON'lar; yalnız geriye uyumlu okuma için). */
export interface FabricSpecV1 {
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
