/**
 * İplik merkez konumu üreticileri (mm). Karşılık: reference/weave_phys.py §2.
 *
 * İplikler global bir indeksle (g, negatif olabilir) adreslenir; aynı g her zaman aynı
 * konuma, aynı örgü sütun/satırına ve aynı slot sırasına düşer. Böylece görünüm penceresi
 * kaydırıldığında kumaş "yerinde" kalır.
 *
 * TASARIM NOTU — ReedPositionGenerator (henüz yazılmadı):
 *   Girdi: tarak diş sıklığı (diş/cm), diş başına tel raporu (ör. [2, 2, 3, 0] → 0 = boş diş),
 *   atkı çekmesiyle mamule ölçek. Bir rapor periyodu = rapor diş sayısı / diş sıklığı (cm);
 *   periyot içindeki her telin ofseti, dişin merkezi etrafında diş içindeki tel sayısına göre
 *   dağıtılır; boş diş yalnızca konumu kaydırır. `centers` periyodik ofset tablosundan
 *   g → (periyot no, periyot içi sıra) ile üretilir; `indexRange` ikili aramayla bulunur;
 *   `meanPitchMm` = periyot / periyottaki tel sayısı. Bu arayüz bunun için yeterlidir.
 */

export interface PositionGenerator {
  /** g = firstIndex .. firstIndex+count−1 ipliklerinin merkezleri (mm, artan). */
  centers(firstIndex: number, count: number): Float64Array;
  /**
   * [x0, x1] mm aralığını, kenarlarda en az birer iplik taşacak şekilde kapsayan iplikler.
   * Uniform üreticide referansın `ceil(view·D/10) + 3` iplik sayısını birebir verir.
   */
  indexRange(x0Mm: number, x1Mm: number): { first: number; count: number };
  /** Ortalama iplik aralığı (mm) = 10 / ortalama sıklık. */
  meanPitchMm(): number;
}

/** Düzgün aralıklı iplikler: c_g = (g + 0.5)·p − p, p = 10 / sıklık. */
export class UniformPositionGenerator implements PositionGenerator {
  readonly pitch: number;

  constructor(readonly densityPerCm: number) {
    if (!(densityPerCm > 0)) throw new Error(`Geçersiz sıklık: ${densityPerCm}`);
    this.pitch = 10 / densityPerCm;
  }

  centers(firstIndex: number, count: number): Float64Array {
    const out = new Float64Array(count);
    for (let k = 0; k < count; k++) out[k] = (firstIndex + k + 0.5) * this.pitch - this.pitch;
    return out;
  }

  indexRange(x0Mm: number, x1Mm: number): { first: number; count: number } {
    const first = Math.floor(x0Mm / this.pitch);
    const count = Math.ceil(((x1Mm - x0Mm) * this.densityPerCm) / 10) + 3;
    return { first, count };
  }

  meanPitchMm(): number {
    return this.pitch;
  }
}
