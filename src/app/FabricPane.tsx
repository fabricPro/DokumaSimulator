import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { AxisPositions, FabricSpec, PositionGenerator } from '../render-engine';
import { DENT_BAND, LINK_BAND, drawReedStrip, type ReedStripInfo } from './reedStrip';
export type { ReedStripInfo } from './reedStrip';
import type { PhysicalInfo } from '../render-engine/worker';
import { imageToCanvas, RenderClient } from './renderClient';
import type { BackgroundPref, DistancePref, QualityPref } from './RealisticLayer';
import { MAGNIFIER_MIN_YARN_PX, meanDiameter, realWeight } from '../realistic/viewDistance';
import { diameterMm, toTex } from '../realistic/yarn';

/** Gerçekçi katman ayrı parça: yalnız "Gerçekçi" açılınca yüklenir (gerçekçi modülle birlikte). */
const RealisticLayer = lazy(() => import('./RealisticLayer'));

/**
 * Gerçekçi görünüm yalnız yakında tam panel çalışır; daha uzakta imleci izleyen büyüteçte.
 * VARSAYIM: 100 px/mm (≈ 10 px / 0.1 mm) altında iplik dokusu seçilemez, GPU'yu tüm panele harcamaya değmez.
 */
export const REALISTIC_FULL_PPM = 100;
export const LOUPE_CSS = 256;
export const LOUPE_ZOOM = 4;

export interface RealisticOptions {
  quality: QualityPref;
  background: BackgroundPref;
  /** Uzak görünümün zemini (Lup modunda da Göz zemini; kullanıcı seçtiyse onun seçimi). */
  farBackground: BackgroundPref;
  /** Bakış seçimi: uzak görünümün filtresi (Göz / Uzak) ve yakın görünüm zemini; geçiş ölçeğe bağlı otomatik. */
  distance: DistancePref;
  /** 'finished': mamul paneli (ortalama mamul sıklığı). */
  densities: 'loom' | 'finished';
  /** Destek yok / bağlam kaybı: uygulama düğmeyi kapatır, CPU render sürer. */
  onUnavailable: () => void;
}

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

/** Atkı için tezgah → mamul bağlantı çizgileri (panelin sol bandında). */
export interface WeftLinks {
  loom: PositionGenerator;
  finished: PositionGenerator;
  /** Tezgah koordinatının ekrandaki alt başlangıcı (mm). */
  loomOriginY: number;
}

const WEFT_LINK_BAND = 26;

interface Props {
  spec: FabricSpec;
  seed: number;
  view: MmView;
  /** "Aynı iplikler" modunda mamul paneli için daralmış pencere; sol alta hizalı çizilir. */
  renderWindow?: MmWindow;
  strips?: BindingStrips;
  reedStrip?: ReedStripInfo;
  weftLinks?: WeftLinks;
  /** Köşe etiketi, ör. "boy %30 kısaldı, en %10 daraldı". */
  shrinkLabel?: string;
  title?: string;
  onViewChange: (v: MmView) => void;
  onInfo?: (info: PhysicalInfo) => void;
  onSize?: (w: number, h: number) => void;
  /** Verilirse gerçekçi katman açık (yakında tam panel, uzakta büyüteç). */
  realistic?: RealisticOptions;
}

const FULL_DELAY_MS = 220;
/** En uzak zoom: 2 px/mm (≈ 30 cm'lik rapor tek panelde; "Gerçek boyut" ön ayarı ~3.8 px/mm bunun içinde). */
export const MIN_PPM = 2;
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
export function FabricPane({
  spec,
  seed,
  view,
  renderWindow,
  strips,
  reedStrip,
  weftLinks,
  shrinkLabel,
  title,
  onViewChange,
  onInfo,
  onSize,
  realistic,
}: Props) {
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [realText, setRealText] = useState('');
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
  const leftW = weftLinks ? WEFT_LINK_BAND : 0;
  const leftRef = useRef(leftW);
  leftRef.current = leftW;
  const weftLinksRef = useRef(weftLinks);
  weftLinksRef.current = weftLinks;
  const labelRef = useRef(shrinkLabel);
  labelRef.current = shrinkLabel;

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
    const left = leftRef.current;
    const h = hTotal - band;
    const v = viewRef.current;
    const win = windowRef.current;
    const s = shownRef.current;
    // Ekran ↔ kumaş eşlemesi. Pencere modunda ("Aynı iplikler") mamul görüntü dikeyde ortalanır:
    // tezgahla aynı iplikler daha kısa bir alana sığdığı için boşluk üstte ve altta eşit kalır.
    const ox = win ? win.x0Mm : v.x0Mm;
    const oy = win ? win.y0Mm : v.y0Mm;
    const winH = win ? Math.min(win.heightMm * v.pxPerMm, h) : h;
    const bottom = band + (win ? (h + winH) / 2 : h);
    const sx = (X: number) => left + (X - ox) * v.pxPerMm;
    const sy = (Y: number) => bottom - (Y - oy) * v.pxPerMm;
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
            ctx.fillRect(left, a, STRIP_PX, b - a - 1);
          }
        }
      };
      drawAxis(st.warp, ox, xMax, true);
      drawAxis(st.weft, oy, yMax, false);
    }
    // Tarak şeridi (aynı px/mm, aynı x eşlemesi)
    const rs = reedRef.current;
    if (rs) {
      ctx.save();
      ctx.translate(left, 0);
      ctx.beginPath();
      ctx.rect(0, 0, w - left, band);
      ctx.clip();
      drawReedStrip(ctx, rs, w - left, v.pxPerMm, rs.loomOriginX ?? ox, ox);
      ctx.restore();
    }
    // Atkı: tezgah y → mamul y bağlantı çizgileri (sol bant)
    const wl = weftLinksRef.current;
    if (wl) {
      ctx.fillStyle = '#d6dade';
      ctx.fillRect(0, band, left, h);
      const loomY = (Y: number) => band + h - (Y - wl.loomOriginY) * v.pxPerMm;
      const r = wl.loom.indexRange(wl.loomOriginY, wl.loomOriginY + h / v.pxPerMm);
      const lc = wl.loom.centers(r.first, r.count);
      const fc = wl.finished.centers(r.first, r.count);
      ctx.strokeStyle = 'rgba(35,39,45,0.75)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 0; k < r.count; k++) {
        const y0 = loomY(lc[k]);
        const y1 = sy(fc[k]);
        if (y0 < band || y0 > band + h) continue;
        ctx.moveTo(0, y0);
        ctx.lineTo(left, y1);
      }
      ctx.stroke();
    }
    // Çekme etiketi (sağ üst)
    const lab = labelRef.current;
    if (lab) {
      ctx.font = '12px system-ui, sans-serif';
      const tw = ctx.measureText(lab).width;
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(w - tw - 18, band + 8, tw + 12, 20);
      ctx.fillStyle = '#ffd666';
      ctx.fillText(lab, w - tw - 12, band + 22);
    }
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
  }, [strips, reedStrip, weftLinks, shrinkLabel, paint]);

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
    const fabricW = Math.max(10, size.w - leftW);
    const wMm = win ? Math.min(win.widthMm, fabricW / v.pxPerMm) : fabricW / v.pxPerMm;
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
  }, [spec, seed, view, size, clients, paint, onInfo, winKey, bandH, leftW]);

  // Tekerlek: imleç altındaki mm noktası sabit kalacak şekilde zoom (tezgah koordinatında)
  useEffect(() => {
    const c = canvasRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      const h = sizeRef.current.h - bandRef.current;
      const rect = c.getBoundingClientRect();
      const mx = e.clientX - rect.left - leftRef.current;
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
  // Büyüteç katmanı (ikinci WebGL bağlamı) ilk kullanıldığında kurulur, sonra bağlı kalır
  const magEver = useRef(false);

  // Gerçekçi katman yerleşimi: paint() ile aynı ekran ↔ kumaş eşlemesi
  type LayerPlace = { rect: { left: number; top: number; width: number; height: number }; originMm: [number, number]; ppm: number; loupe: boolean };
  let layer: LayerPlace | null = null;
  let mag: LayerPlace | null = null;
  // Ortalama iplik çapı (desenin çözgü / atkı slot çaplarının rapor dizisi boyunca ortalaması)
  const slotD = (sl: FabricSpec['warpSlots'][number]) => diameterMm(toTex(sl.count, sl.system), sl.yarnDensity ?? 0.85);
  const dMean = realistic
    ? meanDiameter(
        spec.warpSequence.map((k) => slotD(spec.warpSlots[Math.min(k, spec.warpSlots.length - 1)])),
        spec.weftSequence.map((k) => slotD(spec.weftSlots[Math.min(k, spec.weftSlots.length - 1)])),
      )
    : 0;
  const panelRealWeight = realWeight(dMean, view.pxPerMm);
  if (realistic) {
    const fabricW = size.w - leftW;
    const h = size.h - bandH;
    const ppm = view.pxPerMm;
    const ox = renderWindow ? renderWindow.x0Mm : view.x0Mm;
    const oy = renderWindow ? renderWindow.y0Mm : view.y0Mm;
    const rectW = renderWindow ? Math.min(renderWindow.widthMm * ppm, fabricW) : fabricW;
    const rectH = renderWindow ? Math.min(renderWindow.heightMm * ppm, h) : h;
    const bottom = bandH + (renderWindow ? (h + rectH) / 2 : h);
    // Gerçekçi katman HER ölçekte tam panel: ortalama iplik çapına (px) göre uzak görünüm ↔ gerçekçi lup geçişi
    // renderer'da otomatik (viewDistance.REAL_BLEND_*), her panel kendi px/mm'sine göre bağımsız karar verir.
    layer = { rect: { left: leftW, top: bottom - rectH, width: rectW, height: rectH }, originMm: [ox, oy], ppm, loupe: false };
    // Büyüteç dairesi: panel hâlâ uzak görünümdeyse (gerçekçi lup ağırlığı < 1) imleç altında, ikinci bir katman olarak
    // HER ZAMAN tam gerçekçi lup (forceReal); ortalama iplik çapı en az MAGNIFIER_MIN_YARN_PX piksel olacak kadar büyütülür.
    if (hover && panelRealWeight < 1 && hover.x >= leftW && hover.x <= leftW + rectW && hover.y >= bottom - rectH && hover.y <= bottom) {
      const ppmL = Math.max(ppm * LOUPE_ZOOM, dMean > 0 ? MAGNIFIER_MIN_YARN_PX / dMean : 0);
      const X = ox + (hover.x - leftW) / ppm;
      const Y = oy + (bottom - hover.y) / ppm;
      const half = LOUPE_CSS / 2;
      mag = {
        rect: { left: hover.x - half, top: hover.y - half, width: LOUPE_CSS, height: LOUPE_CSS },
        originMm: [X - half / ppmL, Y - half / ppmL],
        ppm: ppmL,
        loupe: true,
      };
      magEver.current = true; // ikinci bağlam bir kez kurulur, sonra bağlı kalır (her hover'da yeniden kurulmasın)
    }
  }

  return (
    <div className="fabric-pane" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, x0: view.x0Mm, y0: view.y0Mm };
        }}
        onPointerMove={(e) => {
          if (realistic) {
            const r = (e.target as Element).getBoundingClientRect();
            setHover({ x: e.clientX - r.left, y: e.clientY - r.top });
          }
          const d = drag.current;
          if (!d) return;
          const v = viewRef.current;
          onViewChange({ ...v, x0Mm: d.x0 - (e.clientX - d.x) / v.pxPerMm, y0Mm: d.y0 + (e.clientY - d.y) / v.pxPerMm });
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onPointerLeave={() => setHover(null)}
      />
      {realistic && (
        <Suspense fallback={null}>
          <RealisticLayer
            spec={spec}
            seed={seed}
            densities={realistic.densities}
            rect={layer?.rect ?? { left: 0, top: 0, width: 0, height: 0 }}
            originMm={layer?.originMm ?? [0, 0]}
            pxPerMm={layer?.ppm ?? view.pxPerMm}
            loupe={false}
            quality={realistic.quality}
            background={realistic.background}
            farBackground={realistic.farBackground}
            distance={realistic.distance}
            onState={(s) => {
              if (!s.ok) realistic.onUnavailable();
              setRealText(s.text);
            }}
          />
          {(mag || magEver.current) && (
            <RealisticLayer
              spec={spec}
              seed={seed}
              densities={realistic.densities}
              rect={mag?.rect ?? { left: 0, top: 0, width: 0, height: 0 }}
              originMm={mag?.originMm ?? [0, 0]}
              pxPerMm={mag?.ppm ?? view.pxPerMm}
              loupe
              forceReal
              quality={realistic.quality}
              background={realistic.background}
              farBackground={realistic.farBackground}
              distance={realistic.distance}
              onState={(s) => {
                if (!s.ok) realistic.onUnavailable();
              }}
            />
          )}
        </Suspense>
      )}
      {realistic && <ScaleBar pxPerMm={view.pxPerMm} left={leftW + 12} />}
      {title && (
        <div className="pane-title" style={{ top: bandH + 8, left: leftW + 8 }}>
          {title}
        </div>
      )}
      <div className="pane-status">
        {status}
        {realistic && realText && <span className="real-status"> · {realText}</span>}
        {realistic && panelRealWeight < 1 && !mag && <span className="real-status"> · uzak görünüm: büyüteç için imleci kumaşın üstüne getirin</span>}
      </div>
    </div>
  );
}

/** Ölçek çubuğu (gerçekçi katmanın üstünde; CPU tuvalindeki 1 mm çubuğu katman altında kalıyordu): ~80 px'e en yakın
 *  1-2-5 dizisi mm uzunluk. Tüm bakış modlarında görünür. */
function ScaleBar({ pxPerMm, left }: { pxPerMm: number; left: number }) {
  const target = 80 / pxPerMm;
  const p10 = 10 ** Math.floor(Math.log10(target));
  const mm = [1, 2, 5, 10].map((k) => k * p10).reduce((b, c) => (Math.abs(c - target) < Math.abs(b - target) ? c : b));
  const label = mm >= 1 ? `${+mm.toFixed(0)} mm` : `${+mm.toFixed(2)} mm`;
  return (
    <div className="scale-overlay" style={{ left }}>
      <div className="scale-overlay-bar" style={{ width: mm * pxPerMm }} />
      <span>{label}</span>
    </div>
  );
}
