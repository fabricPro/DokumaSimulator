/**
 * İplik merkez konumu üreticileri (mm). Karşılık: reference/weave_phys.py §2.
 *
 * İplikler global bir indeksle (g, negatif olabilir) adreslenir; aynı g her zaman aynı
 * konuma, aynı örgü sütun/satırına ve aynı slot sırasına düşer. Böylece görünüm penceresi
 * kaydırıldığında kumaş "yerinde" kalır.
 *
 * Üreticiler:
 *   - UniformPositionGenerator: düzgün aralık (tarak girilmemişse tezgah konumu; referansla birebir).
 *   - ReedPositionGenerator (render-engine/reed): tarak raporundan tezgah konumu.
 *   - PeriodicPositionGenerator: periyodik ofset tablosu (tarak ve çekme dağılımı sonucu).
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

/** En büyük ortak bölen / en küçük ortak kat. */
export function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return Math.abs(a);
}
export function lcm(a: number, b: number): number {
  return (a / gcd(a, b)) * b;
}

/**
 * Periyodik konum tablosu: c_g = floor(g/P)·periodWidth + offsets[g mod P].
 * offsets artan olmalı ve offsets[P−1] < offsets[0] + periodWidth.
 */
export class PeriodicPositionGenerator implements PositionGenerator {
  readonly period: number;

  constructor(
    readonly offsets: Float64Array,
    readonly periodWidth: number,
  ) {
    if (offsets.length === 0 || !(periodWidth > 0)) throw new Error('Geçersiz periyodik konum tablosu.');
    this.period = offsets.length;
  }

  center(g: number): number {
    const P = this.period;
    const q = Math.floor(g / P);
    return q * this.periodWidth + this.offsets[g - q * P];
  }

  centers(firstIndex: number, count: number): Float64Array {
    const out = new Float64Array(count);
    for (let k = 0; k < count; k++) out[k] = this.center(firstIndex + k);
    return out;
  }

  /** c_g ≤ x olan en büyük g. */
  private floorIndex(x: number): number {
    const P = this.period;
    const q = Math.floor((x - this.offsets[0]) / this.periodWidth);
    let lo = q * P - 1;
    let hi = (q + 1) * P + 1;
    while (this.center(lo) > x) lo -= P;
    while (this.center(hi) <= x) hi += P;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (this.center(mid) <= x) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  indexRange(x0Mm: number, x1Mm: number): { first: number; count: number } {
    const first = this.floorIndex(x0Mm) - 1;
    const last = this.floorIndex(x1Mm) + 2;
    return { first, count: last - first + 1 };
  }

  meanPitchMm(): number {
    return this.periodWidth / this.period;
  }
}
