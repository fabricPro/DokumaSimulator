/**
 * Web Worker giriş noktası. Ağır heightfield hesabını ana thread dışında yapar.
 * Kullanım (Vite): new Worker(new URL('./render-engine/worker.ts', import.meta.url), { type: 'module' })
 *
 * Mesaj: RenderJob → RenderJobResult (piksel tamponu transfer edilir).
 */
import { renderHeightfield } from './heightfield/render';
import type { HeightfieldParams, Region, WeaveInput } from './types';

export interface RenderJob {
  id: number;
  input: WeaveInput;
  params: HeightfieldParams;
  region?: Region;
}

export interface RenderJobResult {
  id: number;
  width: number;
  height: number;
  /** RGBA8 */
  buffer: ArrayBuffer;
  ms: number;
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
    const img = renderHeightfield(job.input, job.params, { region: job.region });
    const buffer = img.data.buffer as ArrayBuffer;
    scope.postMessage(
      { id: job.id, width: img.width, height: img.height, buffer, ms: performance.now() - t0 },
      [buffer],
    );
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
