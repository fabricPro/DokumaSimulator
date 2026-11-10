/**
 * Gerçekçi render modülü — public API.
 * React / uygulama state'i / store bağımlılığı yoktur. Uygulamalar bunu dinamik import ile yükler:
 *   const { isRealisticSupported, createRealisticRenderer } = await import('./realistic');
 */
export { createRealisticRenderer, lightDirection } from './renderer';
export { isRealisticSupported } from './gl/context';
export { packFabric, validateInput, hexToRgba, DEFAULT_TWIST_PER_M } from './pack';
export type { PackedFabric } from './pack';
export { pitchMm, pitchPx, pixelToMm, cellAt, flatColorAt } from './scale';
export { toTex, diameterMm, DEFAULT_YARN_DENSITY } from './yarn';
export { geometryAt, geometryParamsFromInput, flattening, ellipseAxes, DEFAULT_CRIMP_SHARE } from './geometry';
export type { GeometryParams, GeometrySample } from './geometry';
export { twistAngle, grooveSpacingMm, LUSTER_SPECULAR, QUALITY_SAMPLES, srgbToLinear, linearToSrgb, softClip, PLY_COUNT } from './surface';
export { DEFAULT_IRREGULARITY, NO_IRREGULARITY, DEFAULT_SEED, resolveIrregularity } from './irregularity';
export { parsePreset, serializePreset, applySurfaces, applyPresetToView, findYarnType, matchingYarnTypes, DEFAULT_TUNING } from './presets';
export { scaleFromPoints, photoRect, simView, zoomAt } from './calibration';
export type { CalibView, Point } from './calibration';
export type { RealisticPreset, YarnSurface } from './presets';
export {
  VIEW_DISTANCE_MM,
  resolvableMm,
  viewBlurMm,
  cssPxPerMm,
  CARD_WIDTH_MM,
  CSS_DPI,
} from './viewDistance';
export type { ViewDistance } from './viewDistance';
export { PERF_LADDER, FRAME_BUDGET_MS, initialAutoQuality, stepAutoQuality, fixedLevel } from './perf';
export type { PerfLevel, AutoQualityState } from './perf';
export type * from './types';
