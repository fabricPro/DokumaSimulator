/**
 * Dokuma render motoru — tek public giriş noktası.
 * React/DOM/global uygulama state'i bağımlılığı yoktur; bu klasör olduğu gibi başka projeye kopyalanabilir.
 */
export * from './types';
export { yarnDiameterMm, spacingMm, yarnGeometry, DEFAULT_FIBER_DENSITY, toTex as toTexV1 } from './geometry';
export type { YarnGeometry } from './geometry';
export * from './physical';
export { parseColor, toHex, cycleColor } from './color';
export { mulberry32, hash3 } from './random';
export { smoothstep, pmod, warpSign, weftSign, alongWave, crossProfile, ply } from './heightfield/wave';
export { gaussianKernel, gaussianBlur } from './heightfield/gaussian';
export { createRandomSource, constantRandomSource, noiseTextures, NOISE_TILE } from './heightfield/random';
export {
  renderHeightfield,
  imageSize,
  clampRegion,
  validateInput,
  REGION_PAD,
  fieldsPass,
  lightingPass,
  shadowPass,
  occlusionPass,
  compositePass,
} from './heightfield/render';
export type { RenderHeightfieldOptions } from './heightfield/render';

import type { FabricSpecV1, HeightfieldParams, WeaveInput } from './types';

/** FabricSpec → render girdisi (rapor tekrarı iplik sayısına çevrilir). */
export function weaveInputFromSpec(spec: FabricSpecV1): WeaveInput {
  const h = spec.weave.length;
  const w = spec.weave[0]?.length ?? 0;
  return {
    weave: spec.weave,
    warpColors: spec.warpColors,
    weftColors: spec.weftColors,
    nWarp: w * Math.max(1, Math.floor(spec.repeatX)),
    nWeft: h * Math.max(1, Math.floor(spec.repeatY)),
  };
}

/**
 * Düşük çözünürlüklü önizleme için parametreleri ölçekler (ör. 0.5x).
 * Piksel cinsinden değerler (cell, wobble) ölçeklenir; oranlar aynı kalır.
 */
export function scaleParams(p: HeightfieldParams, s: number): HeightfieldParams {
  return { ...p, cell: p.cell * s, wobble: p.wobble * s };
}
