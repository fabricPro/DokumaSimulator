/**
 * Tarak modülü (saf; React/DOM bağımlılığı yok).
 */
export * from './types';
export { toDentsPerCm, fromDentsPerCm, dentPitchMm } from './units';
export { parseDenting, formatDenting, MAX_DENTS } from './parse';
export type { ParseResult } from './parse';
export { deriveReed } from './derive';
export type { ReedDerived, ReedTotals } from './derive';
export { ReedPositionGenerator, FIT_LIMIT } from './layout';
export type { DentGeometry, OverfullDent } from './layout';
