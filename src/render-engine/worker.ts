/**
 * Web Worker giriş noktası. Ağır render hesabını ana thread dışında yapar.
 * Kullanım (Vite): new Worker(new URL('./render-engine/worker.ts', import.meta.url), { type: 'module' })
 *
 * İki iş tipi: 'heightfield' (v1, cell tabanlı) ve 'physical' (v2, mm ölçekli).
 */
import { renderHeightfield } from './heightfield/render';
import { computeMetrics, type FabricMetrics } from './physical/metrics';
import { simulatePhysical, type PhysicalView } from './physical/simulate';
import type { FabricSpec, HeightfieldParams, Region, WeaveInput } from './types';

export interface HeightfieldJob {
  kind?: 'heightfield';
  id: number;
  input: WeaveInput;
  params: HeightfieldParams;
  region?: Region;
}

export interface PhysicalJob {
  kind: 'physical';
  id: number;
  spec: FabricSpec;
  view: PhysicalView;
  seed: number;
  scaleBar?: boolean;
}

export type RenderJob = HeightfieldJob | PhysicalJob;

export interface PhysicalInfo {
  openPct: number;
  jammedWarp: boolean;
  jammedWeft: boolean;
  /** Penceredeki ipliklerle (referans gibi) hesaplanmış metrikler. */
  metrics: FabricMetrics;
}

export interface RenderJobResult {
  id: number;
  width: number;
  height: number;
  /** RGBA8 */
  buffer: ArrayBuffer;
  ms: number;
  physical?: PhysicalInfo;
  error?: string;
}

const scope = globalThis as unknown as {
  onmessage: ((e: { data: RenderJob }) => void) | null;
  postMessage(msg: RenderJobResult, transfer?: ArrayBuffer[]): void;
};

scope.onmessage = (e) => {
  const job = e.data;
  const t0 = performance.now();
  try {
    if (job.kind === 'physical') {
      const res = simulatePhysical(job.spec, job.view, { seed: job.seed, scaleBar: job.scaleBar });
      const buffer = res.image.data.buffer as ArrayBuffer;
      scope.postMessage(
        {
          id: job.id,
          width: res.image.width,
          height: res.image.height,
          buffer,
          ms: performance.now() - t0,
          physical: {
            openPct: res.openPct,
            jammedWarp: res.jammedWarp,
            jammedWeft: res.jammedWeft,
            metrics: computeMetrics(job.spec, { warpSlotsUsed: res.warpSlotsUsed, weftSlotsUsed: res.weftSlotsUsed }),
          },
        },
        [buffer],
      );
      return;
    }
    const img = renderHeightfield(job.input, job.params, { region: job.region });
    const buffer = img.data.buffer as ArrayBuffer;
    scope.postMessage({ id: job.id, width: img.width, height: img.height, buffer, ms: performance.now() - t0 }, [buffer]);
  } catch (err) {
    scope.postMessage({
      id: job.id,
      width: 0,
      height: 0,
      buffer: new ArrayBuffer(0),
      ms: performance.now() - t0,
      error: (err as Error).message,
    });
  }
};
