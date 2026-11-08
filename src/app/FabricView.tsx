import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { imageSize, scaleParams, type HeightfieldParams, type WeaveInput } from '../render-engine';
import { imageToCanvas, RenderClient } from './renderClient';

/** Görünüm: zoom = cell (px/iplik), pan = görünümün sol üstünün tam görüntüdeki konumu (px). */
export interface ViewState {
  cell: number;
  panX: number;
  panY: number;
}

export interface FabricViewHandle {
  fit(): void;
}

interface Props {
  input: WeaveInput;
  params: Omit<HeightfieldParams, 'cell'>;
  view: ViewState;
  onViewChange: (v: ViewState) => void;
}

const MIN_CELL = 2;
const MAX_CELL = 160;
const FULL_DELAY_MS = 220;

interface Shown {
  canvas: HTMLCanvasElement;
  /** Bu bitmap hangi görünüm için üretildi. */
  view: ViewState;
  /** Bitmap'in tam görüntüdeki bölgesi (o görünümün ölçeğinde px). */
  rx: number;
  ry: number;
  rw: number;
  rh: number;
}

export const FabricView = forwardRef<FabricViewHandle, Props>(function FabricView(
  { input, params, view, onViewChange },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [status, setStatus] = useState('');
  const shownRef = useRef<Shown | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  // Worker'lar efekt içinde oluşturulur (StrictMode çift mount'unda sonlandırılmış worker kalmasın)
  const [clients, setClients] = useState<{ preview: RenderClient; full: RenderClient } | null>(null);
  useEffect(() => {
    const c = { preview: new RenderClient(), full: new RenderClient() };
    setClients(c);
    return () => {
      c.preview.dispose();
      c.full.dispose();
    };
  }, []);

  // Kapsayıcı boyutu
  useEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => {
      setSize({ w: Math.max(50, Math.floor(el.clientWidth)), h: Math.max(50, Math.floor(el.clientHeight)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** Son bitmap'i mevcut görünüme dönüştürerek çiz (zoom/pan sırasında anında geri bildirim). */
  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b0c0e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const s = shownRef.current;
    if (!s) return;
    const v = viewRef.current;
    const k = v.cell / s.view.cell;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(s.canvas, s.rx * k - v.panX, s.ry * k - v.panY, s.rw * k, s.rh * k);
  }, []);

  useEffect(() => {
    const c = canvasRef.current!;
    c.width = size.w;
    c.height = size.h;
    paint();
  }, [size, paint]);

  // Render zamanlaması: hemen 0.5x önizleme, durunca tam çözünürlük
  useEffect(() => {
    paint();
    if (!clients) return;
    const { preview, full } = clients;
    const v = view;
    const { width: W, height: H } = imageSize(input, v.cell);
    const region = { x: v.panX, y: v.panY, width: size.w, height: size.h };
    const accept = (img: HTMLCanvasElement, scale: number, r: { x: number; y: number; width: number; height: number }) => {
      shownRef.current = {
        canvas: img,
        view: v,
        rx: r.x / scale,
        ry: r.y / scale,
        rw: r.width / scale,
        rh: r.height / scale,
      };
      paint();
    };
    const clampR = (s: number) => {
      const x = Math.max(0, Math.floor(region.x * s));
      const y = Math.max(0, Math.floor(region.y * s));
      const x1 = Math.min(Math.round(W * s), Math.ceil((region.x + region.width) * s));
      const y1 = Math.min(Math.round(H * s), Math.ceil((region.y + region.height) * s));
      return { x, y, width: Math.max(0, x1 - x), height: Math.max(0, y1 - y) };
    };

    let cancelled = false;
    let gotFull = false;
    const pr = clampR(0.5);
    if (pr.width > 0 && pr.height > 0) {
      setStatus('önizleme…');
      preview.request(input, scaleParams({ ...params, cell: v.cell }, 0.5), pr).then((res) => {
        if (cancelled || gotFull || !res) return;
        accept(imageToCanvas(res.image), 0.5, pr);
      });
    }
    const timer = setTimeout(() => {
      const fr = clampR(1);
      if (fr.width === 0 || fr.height === 0) return;
      setStatus('render…');
      full.request(input, { ...params, cell: v.cell }, fr).then((res) => {
        if (cancelled || !res) return;
        gotFull = true;
        accept(imageToCanvas(res.image), 1, fr);
        setStatus(`${res.image.width}×${res.image.height} px · ${Math.round(res.ms)} ms`);
      });
    }, FULL_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [input, params, view, size, clients, paint]);

  const fit = useCallback(() => {
    const cell = Math.max(MIN_CELL, Math.min(MAX_CELL, Math.min(size.w / input.nWarp, size.h / input.nWeft)));
    const { width: W, height: H } = imageSize(input, cell);
    onViewChange({ cell, panX: Math.round((W - size.w) / 2), panY: Math.round((H - size.h) / 2) });
  }, [size, input, onViewChange]);
  useImperativeHandle(ref, () => ({ fit }), [fit]);

  // Fare tekerleği: imleç merkezli zoom
  useEffect(() => {
    const c = canvasRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      const rect = c.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const cell = Math.max(MIN_CELL, Math.min(MAX_CELL, v.cell * Math.exp(-e.deltaY * 0.0015)));
      const k = cell / v.cell;
      onViewChange({ cell, panX: (v.panX + mx) * k - mx, panY: (v.panY + my) * k - my });
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  }, [onViewChange]);

  // Sürükle-kaydır
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, panX: view.panX, panY: view.panY };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    onViewChange({ ...viewRef.current, panX: d.panX - (e.clientX - d.x), panY: d.panY - (e.clientY - d.y) });
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <div className="fabric-view" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <div className="view-hud">
        <span>{view.cell.toFixed(1)} px/iplik</span>
        <span>{status}</span>
        <button onClick={fit}>Ekrana sığdır</button>
      </div>
    </div>
  );
});
