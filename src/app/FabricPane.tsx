import { useCallback, useEffect, useRef, useState } from 'react';
import type { FabricSpec } from '../render-engine';
import type { PhysicalInfo } from '../render-engine/worker';
import { imageToCanvas, RenderClient } from './renderClient';

/** Görünüm penceresi: sol alt köşe (mm) ve px/mm. */
export interface MmView {
  x0Mm: number;
  y0Mm: number;
  pxPerMm: number;
}

interface Props {
  spec: FabricSpec;
  seed: number;
  view: MmView;
  title?: string;
  onViewChange: (v: MmView) => void;
  onInfo?: (info: PhysicalInfo) => void;
  onSize?: (w: number, h: number) => void;
}

const FULL_DELAY_MS = 220;
export const MIN_PPM = 15;
export const MAX_PPM = 600;

interface Shown {
  canvas: HTMLCanvasElement;
  x0: number;
  y0: number;
  wMm: number;
  hMm: number;
}

/** Tek bir kumaş paneli: 0.5x önizleme → tam render, tekerlek zoom, sürükle-kaydır (mm). */
export function FabricPane({ spec, seed, view, title, onViewChange, onInfo, onSize }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 400, h: 400 });
  const [status, setStatus] = useState('');
  const shownRef = useRef<Shown | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const sizeRef = useRef(size);
  sizeRef.current = size;

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

  /** Son bitmap'i mevcut görünüme dönüştürerek çiz + ölçek çubuğu. */
  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const { w, h } = sizeRef.current;
    ctx.fillStyle = '#090a0d';
    ctx.fillRect(0, 0, w, h);
    const v = viewRef.current;
    const s = shownRef.current;
    if (s) {
      const hMm = h / v.pxPerMm;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(
        s.canvas,
        (s.x0 - v.x0Mm) * v.pxPerMm,
        (v.y0Mm + hMm - (s.y0 + s.hMm)) * v.pxPerMm,
        s.wMm * v.pxPerMm,
        s.hMm * v.pxPerMm,
      );
    }
    // 1 mm ölçek çubuğu
    ctx.fillStyle = 'rgba(240,240,240,0.95)';
    ctx.fillRect(12, h - 30, v.pxPerMm, 6);
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText('1 mm', 12, h - 36);
  }, []);

  useEffect(() => {
    const c = canvasRef.current!;
    c.width = size.w;
    c.height = size.h;
    paint();
  }, [size, paint]);

  useEffect(() => {
    paint();
    if (!clients) return;
    const v = view;
    const wMm = size.w / v.pxPerMm;
    const hMm = size.h / v.pxPerMm;
    let cancelled = false;
    let gotFull = false;
    const job = (scale: number) => ({
      kind: 'physical' as const,
      spec,
      seed,
      scaleBar: false,
      view: { x0Mm: v.x0Mm, y0Mm: v.y0Mm, widthMm: wMm, heightMm: hMm, pxPerMm: v.pxPerMm * scale },
    });
    const accept = (res: { image: { width: number; height: number } } & { image: any }, scale: number) => {
      shownRef.current = {
        canvas: imageToCanvas(res.image),
        x0: v.x0Mm,
        y0: v.y0Mm,
        wMm: res.image.width / (v.pxPerMm * scale),
        hMm: res.image.height / (v.pxPerMm * scale),
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
  }, [spec, seed, view, size, clients, paint, onInfo]);

  // Tekerlek: imleç altındaki mm noktası sabit kalacak şekilde zoom
  useEffect(() => {
    const c = canvasRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      const { h } = sizeRef.current;
      const rect = c.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
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
      {title && <div className="pane-title">{title}</div>}
      <div className="pane-status">{status}</div>
    </div>
  );
}
