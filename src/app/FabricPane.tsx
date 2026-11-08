import { useCallback, useEffect, useRef, useState } from 'react';
import type { AxisPositions, FabricSpec } from '../render-engine';
import { DENT_BAND, LINK_BAND, drawReedStrip, type ReedStripInfo } from './reedStrip';
export type { ReedStripInfo } from './reedStrip';
import type { PhysicalInfo } from '../render-engine/worker';
import { imageToCanvas, RenderClient } from './renderClient';

/** Görünüm penceresi: sol alt köşe (mm) ve px/mm. */
export interface MmView {
  x0Mm: number;
  y0Mm: number;
  pxPerMm: number;
}

/** Bu panelde render edilecek kumaş penceresi (mm); verilmezse görünüm penceresi kullanılır. */
export interface MmWindow {
  x0Mm: number;
  y0Mm: number;
  widthMm: number;
  heightMm: number;
}

export interface BindingStrips {
  warp: AxisPositions;
  weft: AxisPositions;
  /** Hangi konumlar: tezgah mı mamul mü. */
  which: 'loom' | 'finished';
}

interface Props {
  spec: FabricSpec;
  seed: number;
  view: MmView;
  /** "Aynı iplikler" modunda mamul paneli için daralmış pencere; sol alta hizalı çizilir. */
  renderWindow?: MmWindow;
  strips?: BindingStrips;
  reedStrip?: ReedStripInfo;
  title?: string;
  onViewChange: (v: MmView) => void;
  onInfo?: (info: PhysicalInfo) => void;
  onSize?: (w: number, h: number) => void;
}

const FULL_DELAY_MS = 220;
export const MIN_PPM = 15;
export const MAX_PPM = 600;
const STRIP_PX = 6;

interface Shown {
  canvas: HTMLCanvasElement;
  x0: number;
  y0: number;
  wMm: number;
  hMm: number;
  /** Pencere modunda: ekranda sol alta hizalı. */
  anchored: boolean;
}

/** w (0..1) → yeşil..kırmızı. */
function bindingColor(w: number): string {
  const h = 120 * (1 - Math.max(0, Math.min(1, w)));
  return `hsl(${h}, 85%, 50%)`;
}

/** Tek bir kumaş paneli: 0.5x önizleme → tam render, tekerlek zoom, sürükle-kaydır (mm). */
export function FabricPane({ spec, seed, view, renderWindow, strips, reedStrip, title, onViewChange, onInfo, onSize }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 400, h: 400 });
  const [status, setStatus] = useState('');
  const shownRef = useRef<Shown | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const stripsRef = useRef(strips);
  stripsRef.current = strips;
  const windowRef = useRef(renderWindow);
  windowRef.current = renderWindow;
  const reedRef = useRef(reedStrip);
  reedRef.current = reedStrip;
  const bandH = reedStrip ? DENT_BAND + (reedStrip.finished ? LINK_BAND : 0) : 0;
  const bandRef = useRef(bandH);
  bandRef.current = bandH;

  const [clients, setClients] = useState<{ preview: RenderClient; full: RenderClient } | null>(null);
  useEffect(() => {
    const c = { preview: new RenderClient(), full: new RenderClient() };
    setClients(c);
    return () => {
      c.preview.dispose();
      c.full.dispose();
    };
  }, []);

  useEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => {
      const w = Math.max(50, Math.floor(el.clientWidth));
      const h = Math.max(50, Math.floor(el.clientHeight));
      setSize({ w, h });
      onSize?.(w, h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [onSize]);

  /** Son bitmap'i mevcut görünüme dönüştürerek çiz + w şeritleri + ölçek çubuğu. */
  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const { w, h: hTotal } = sizeRef.current;
    ctx.fillStyle = '#090a0d';
    ctx.fillRect(0, 0, w, hTotal);
    const band = bandRef.current;
    const h = hTotal - band;
    const v = viewRef.current;
    const win = windowRef.current;
    const s = shownRef.current;
    // Ekran ↔ kumaş eşlemesi: pencere modunda pencerenin sol altı ekranın sol altına oturur
    const ox = win ? win.x0Mm : v.x0Mm;
    const oy = win ? win.y0Mm : v.y0Mm;
    const sx = (X: number) => (X - ox) * v.pxPerMm;
    const sy = (Y: number) => band + h - (Y - oy) * v.pxPerMm;
    if (s) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(s.canvas, sx(s.x0), sy(s.y0 + s.hMm), s.wMm * v.pxPerMm, s.hMm * v.pxPerMm);
    }
    // w_k şeritleri: üstte çözgü aralıkları, solda atkı aralıkları
    const st = stripsRef.current;
    if (st) {
      const xMax = win ? win.x0Mm + win.widthMm : v.x0Mm + w / v.pxPerMm;
      const yMax = win ? win.y0Mm + win.heightMm : v.y0Mm + h / v.pxPerMm;
      const drawAxis = (ax: AxisPositions, lo: number, hi: number, horizontal: boolean) => {
        const gen = st.which === 'loom' ? ax.loom : ax.finished;
        const r = gen.indexRange(lo, hi);
        const c = gen.centers(r.first, r.count + 1);
        for (let k = 0; k < r.count; k++) {
          const g = r.first + k;
          const wk = ax.binding[((g % ax.period) + ax.period) % ax.period];
          ctx.fillStyle = bindingColor(wk);
          if (horizontal) {
            const a = sx(c[k]);
            const b = sx(c[k + 1]);
            ctx.fillRect(a, band, b - a - 1, STRIP_PX);
          } else {
            const a = sy(c[k + 1]);
            const b = sy(c[k]);
            ctx.fillRect(0, a, STRIP_PX, b - a - 1);
          }
        }
      };
      drawAxis(st.warp, ox, xMax, true);
      drawAxis(st.weft, oy, yMax, false);
    }
    // Tarak şeridi (aynı px/mm, aynı x eşlemesi)
    const rs = reedRef.current;
    if (rs) drawReedStrip(ctx, rs, w, v.pxPerMm, rs.loomOriginX ?? ox, ox);
    // 1 mm ölçek çubuğu
    ctx.fillStyle = 'rgba(240,240,240,0.95)';
    ctx.fillRect(12, hTotal - 30, v.pxPerMm, 6);
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText('1 mm', 12, hTotal - 36);
  }, []);

  useEffect(() => {
    const c = canvasRef.current!;
    c.width = size.w;
    c.height = size.h;
    paint();
  }, [size, paint]);

  useEffect(() => {
    paint();
  }, [strips, reedStrip, paint]);

  const winKey = renderWindow
    ? `${renderWindow.x0Mm}|${renderWindow.y0Mm}|${renderWindow.widthMm}|${renderWindow.heightMm}`
    : '';

  useEffect(() => {
    paint();
    if (!clients) return;
    const v = view;
    const win = windowRef.current;
    const rx0 = win ? win.x0Mm : v.x0Mm;
    const ry0 = win ? win.y0Mm : v.y0Mm;
    const fabricH = Math.max(10, size.h - bandH);
    const wMm = win ? Math.min(win.widthMm, size.w / v.pxPerMm) : size.w / v.pxPerMm;
    const hMm = win ? Math.min(win.heightMm, fabricH / v.pxPerMm) : fabricH / v.pxPerMm;
    let cancelled = false;
    let gotFull = false;
    const job = (scale: number) => ({
      kind: 'physical' as const,
      spec,
      seed,
      scaleBar: false,
      view: { x0Mm: rx0, y0Mm: ry0, widthMm: wMm, heightMm: hMm, pxPerMm: v.pxPerMm * scale },
    });
    const accept = (res: { image: { width: number; height: number; data: Uint8ClampedArray } }, scale: number) => {
      shownRef.current = {
        canvas: imageToCanvas(res.image),
        x0: rx0,
        y0: ry0,
        wMm: res.image.width / (v.pxPerMm * scale),
        hMm: res.image.height / (v.pxPerMm * scale),
        anchored: !!win,
      };
      paint();
    };
    setStatus('önizleme…');
    clients.preview.request(job(0.5)).then((res) => {
      if (cancelled || gotFull || !res) return;
      accept(res, 0.5);
    });
    const timer = setTimeout(() => {
      setStatus('render…');
      clients.full.request(job(1)).then((res) => {
        if (cancelled || !res) return;
        gotFull = true;
        accept(res, 1);
        if (res.physical) onInfo?.(res.physical);
        setStatus(`${res.image.width}×${res.image.height} px · ${Math.round(res.ms)} ms`);
      });
    }, FULL_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // winKey pencere içeriğini temsil eder
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, seed, view, size, clients, paint, onInfo, winKey, bandH]);

  // Tekerlek: imleç altındaki mm noktası sabit kalacak şekilde zoom (tezgah koordinatında)
  useEffect(() => {
    const c = canvasRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      const h = sizeRef.current.h - bandRef.current;
      const rect = c.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top - bandRef.current;
      const ppm = Math.max(MIN_PPM, Math.min(MAX_PPM, v.pxPerMm * Math.exp(-e.deltaY * 0.0015)));
      const X = v.x0Mm + mx / v.pxPerMm;
      const Y = v.y0Mm + (h - my) / v.pxPerMm;
      onViewChange({ pxPerMm: ppm, x0Mm: X - mx / ppm, y0Mm: Y - (h - my) / ppm });
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  }, [onViewChange]);

  const drag = useRef<{ x: number; y: number; x0: number; y0: number } | null>(null);
  return (
    <div className="fabric-pane" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, x0: view.x0Mm, y0: view.y0Mm };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const v = viewRef.current;
          onViewChange({ ...v, x0Mm: d.x0 - (e.clientX - d.x) / v.pxPerMm, y0Mm: d.y0 + (e.clientY - d.y) / v.pxPerMm });
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      />
      {title && (
        <div className="pane-title" style={{ top: bandH + 8 }}>
          {title}
        </div>
      )}
      <div className="pane-status">{status}</div>
    </div>
  );
}
