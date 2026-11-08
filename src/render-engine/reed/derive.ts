/**
 * Taraktan türetilen değerler (UI kartı ve uyarılar için).
 */
import { DEFAULT_WIRE_RATIO, type ReedSpec } from './types';
import { dentPitchMm, toDentsPerCm } from './units';

export interface ReedTotals {
  /** Tarak enindeki toplam diş. */
  dents: number;
  /** Toplam tel (çözgü). */
  ends: number;
  /** Tam rapor sayısı. */
  fullRepeats: number;
  /** Son eksik raporun diş sayısı (0 ise eksik rapor yok). */
  partialDents: number;
}

export interface ReedDerived {
  dentsPerCm: number;
  /** Diş adımı p (mm). */
  pitchMm: number;
  /** Dişin açık genişliği (mm) = p·(1 − wireRatio). */
  openingMm: number;
  wireRatio: number;
  /** Rapor uzunluğu (diş) ve rapordaki tel sayısı. */
  reportDents: number;
  reportEnds: number;
  /** Ortalama tel/diş = Σ rapor / rapor uzunluğu. */
  avgEndsPerDent: number;
  /** Tezgah çözgü sıklığı (tel/cm) = diş/cm × ortalama tel/diş. */
  loomWarpDensity: number;
  /** Rapor genişliği (mm) = rapor uzunluğu × p. */
  reportWidthMm: number;
  totals?: ReedTotals;
  warnings: string[];
}

export function deriveReed(spec: ReedSpec, enteredWarpDensity?: number): ReedDerived {
  const dentsPerCm = toDentsPerCm(spec.reedNumber, spec.reedUnit ?? 'diş/cm');
  const pitchMm = dentPitchMm(dentsPerCm);
  const wireRatio = Math.min(0.95, Math.max(0, spec.wireRatio ?? DEFAULT_WIRE_RATIO));
  const report = spec.dentingReport;
  const reportDents = report.length;
  const reportEnds = report.reduce((a, b) => a + b, 0);
  if (reportDents === 0 || reportEnds === 0) throw new Error('Taraklama raporunda en az bir dişte tel olmalı.');
  const avgEndsPerDent = reportEnds / reportDents;
  const loomWarpDensity = dentsPerCm * avgEndsPerDent;
  const warnings: string[] = [];
  let totals: ReedTotals | undefined;
  if (spec.reedWidthCm && spec.reedWidthCm > 0) {
    const dents = Math.round(spec.reedWidthCm * dentsPerCm);
    const off = spec.startOffset ?? 0;
    let ends = 0;
    for (let j = 0; j < dents; j++) ends += report[(((j + off) % reportDents) + reportDents) % reportDents];
    const fullRepeats = Math.floor(dents / reportDents);
    const partialDents = dents - fullRepeats * reportDents;
    totals = { dents, ends, fullRepeats, partialDents };
    if (partialDents > 0) {
      warnings.push(`Tarak eninde ${fullRepeats} tam rapor ve ${partialDents} dişlik eksik rapor var.`);
    }
  }
  if (enteredWarpDensity !== undefined && Math.abs(enteredWarpDensity - loomWarpDensity) / loomWarpDensity > 0.01) {
    warnings.push(
      `Girilen tezgah çözgü sıklığı ${enteredWarpDensity} tel/cm, taraktan türetilen ${loomWarpDensity.toFixed(2)} tel/cm; tarak kullanılıyor.`,
    );
  }
  return {
    dentsPerCm,
    pitchMm,
    openingMm: pitchMm * (1 - wireRatio),
    wireRatio,
    reportDents,
    reportEnds,
    avgEndsPerDent,
    loomWarpDensity,
    reportWidthMm: reportDents * pitchMm,
    totals,
    warnings,
  };
}
