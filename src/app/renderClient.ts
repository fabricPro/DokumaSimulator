import type { RgbaImage } from '../render-engine';
import type { PhysicalInfo, RenderJob, RenderJobResult } from '../render-engine/worker';

export interface RenderResult {
  image: RgbaImage;
  ms: number;
  physical?: PhysicalInfo;
}

type JobBody = RenderJob extends infer J ? (J extends { id: number } ? Omit<J, 'id'> : never) : never;

/**
 * Tek bir Web Worker'ı saran, "en son istek kazanır" kuyruğu.
 * Worker meşgulken gelen istekler birikmez; yalnızca en sonuncusu bekletilir.
 */
export class RenderClient {
  private worker: Worker;
  private nextId = 1;
  private busy = false;
  private pending: { job: RenderJob; resolve: (r: RenderResult | null) => void } | null = null;
  private inflight: { id: number; resolve: (r: RenderResult | null) => void } | null = null;

  constructor() {
    this.worker = new Worker(new URL('../render-engine/worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<RenderJobResult>) => this.onResult(e.data);
  }

  /** İsteği kuyruğa koyar. Daha yeni bir istek onu geçersiz kılarsa null döner. */
  request(body: JobBody): Promise<RenderResult | null> {
    return new Promise((resolve) => {
      const job = { ...body, id: this.nextId++ } as RenderJob;
      if (this.pending) this.pending.resolve(null);
      this.pending = { job, resolve };
      this.pump();
    });
  }

  private pump(): void {
    if (this.busy || !this.pending) return;
    const { job, resolve } = this.pending;
    this.pending = null;
    this.busy = true;
    this.inflight = { id: job.id, resolve };
    this.worker.postMessage(job);
  }

  private onResult(res: RenderJobResult): void {
    this.busy = false;
    const cur = this.inflight;
    this.inflight = null;
    if (cur && cur.id === res.id) {
      if (res.error) {
        console.error('Render hatası:', res.error);
        cur.resolve(null);
      } else {
        cur.resolve({
          image: { width: res.width, height: res.height, data: new Uint8ClampedArray(res.buffer) },
          ms: res.ms,
          physical: res.physical,
        });
      }
    }
    this.pump();
  }

  dispose(): void {
    this.worker.terminate();
  }
}

/** RgbaImage → <canvas> (drawImage ile ölçekli çizim için). */
export function imageToCanvas(img: RgbaImage): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d')!;
  const id = new ImageData(img.width, img.height);
  id.data.set(img.data);
  ctx.putImageData(id, 0, 0);
  return c;
}
