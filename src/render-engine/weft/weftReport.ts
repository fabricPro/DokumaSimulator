/**
 * Atkı sıklık raporu (tarak raporunun atkıdaki karşılığı). Elektronik sarmalı tezgahlarda atkı
 * sıklığı atkı başına programlanabilir: rapor, her atkıdan sonraki tezgah adımının çarpanıdır.
 *   "1-1-1-3" → 3 atkı normal adımda (p₀), 4. atkıdan sonra 3·p₀ aralık.
 * p₀ = 10 / tezgah atkı sıklığı (mm). Rapor boşsa eşit adım kullanılır (UniformPositionGenerator).
 * Sözdizimi taraklama raporuyla aynıdır (parseDenting); 0 adım geçersizdir.
 */
import { PeriodicPositionGenerator } from '../physical/positions';
import { parseDenting, type ParseResult } from '../reed/parse';

export function parseWeftReport(text: string): ParseResult {
  if (text.trim() === '') return { ok: false, error: 'Atkı sıklık raporu boş.', position: 0 };
  const r = parseDenting(text);
  if (!r.ok) return r;
  const zero = r.report.indexOf(0);
  if (zero >= 0) return { ok: false, error: `${zero + 1}. atkının adımı 0: atkı adımı en az 1 olmalı.`, position: 0 };
  return r;
}

export interface WeftReportDerived {
  /** Rapor uzunluğu (atkı). */
  picks: number;
  /** Σ çarpan. */
  steps: number;
  /** Ortalama tezgah atkı sıklığı (atkı/cm) = taban sıklık / ortalama çarpan. */
  meanDensity: number;
  /** Rapor uzunluğu (mm). */
  lengthMm: number;
}

export function deriveWeftReport(baseDensityPerCm: number, report: number[]): WeftReportDerived {
  if (!(baseDensityPerCm > 0)) throw new Error('Tezgah atkı sıklığı pozitif olmalı.');
  if (report.length === 0 || report.some((m) => !(m > 0))) throw new Error('Atkı sıklık raporunda her adım en az 1 olmalı.');
  const steps = report.reduce((a, b) => a + b, 0);
  const p0 = 10 / baseDensityPerCm;
  return {
    picks: report.length,
    steps,
    meanDensity: (baseDensityPerCm * report.length) / steps,
    lengthMm: steps * p0,
  };
}

/** Atkı raporundan tezgah atkı konumları: c₀ = −p₀/2 (düzgün üreticiyle aynı), c_{j+1} = c_j + çarpan_j·p₀. */
export class WeftReportPositionGenerator extends PeriodicPositionGenerator {
  readonly report: number[];
  readonly baseDensity: number;

  constructor(baseDensityPerCm: number, report: number[]) {
    const d = deriveWeftReport(baseDensityPerCm, report);
    const p0 = 10 / baseDensityPerCm;
    const offsets = new Float64Array(report.length);
    offsets[0] = -0.5 * p0;
    for (let j = 1; j < report.length; j++) offsets[j] = offsets[j - 1] + report[j - 1] * p0;
    super(offsets, d.lengthMm);
    this.report = report.slice();
    this.baseDensity = baseDensityPerCm;
  }
}
