/**
 * Çekme → mamul sıklık. Karşılık: reference/weave_phys.py simulate() başı.
 * Çözgü çekmesi boyu kısaltır → atkı sıklığı artar; atkı çekmesi eni daraltır → çözgü sıklığı artar.
 */

export interface FinishedDensities {
  /** Mamul çözgü sıklığı, tel/cm. */
  warp: number;
  /** Mamul atkı sıklığı, atkı/cm. */
  weft: number;
}

export function finishedDensities(
  warpDensityLoom: number,
  weftDensityLoom: number,
  warpShrinkPct: number,
  weftShrinkPct: number,
): FinishedDensities {
  const sw = warpShrinkPct / 100;
  const sf = weftShrinkPct / 100;
  if (!(sw < 1 && sf < 1)) throw new Error('Çekme %100 veya üstü olamaz.');
  return {
    warp: warpDensityLoom / (1 - sf),
    weft: weftDensityLoom / (1 - sw),
  };
}
