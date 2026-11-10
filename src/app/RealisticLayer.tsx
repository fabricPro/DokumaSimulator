/**
 * Faz 6: kumaş panelinin üstünde gerçekçi (WebGL2) katman. FabricPane bunu lazy yükler; gerçekçi modül
 * yalnız bu parçayla gelir. Destek yoksa, bağlam kaybolursa ya da modül yüklenemezse `onState({ ok: false })`
 * çağrılır ve hiçbir şey çizilmez: altta CPU render'ı zaten durur (sessiz geri dönüş).
 *
 * Konum sözleşmesi: `rect` panel içi CSS pikseli; `originMm` dikdörtgenin SOL ALT köşesinin kumaştaki
 * yeri (mm, y yukarı) — FabricPane'in CPU çiziminde kullandığı eşlemeyle aynı.
 *
 * Önbellek profilleri (fix-v2 adım 2):
 *  - masaüstü (düzenleme): ao / gölge / tüy döşemeye pişirilir; gezinirken (150 ms içinde ardışık görünüm
 *    değişimi) yarım çözünürlük, durunca tam kalite (ilerleyen kalite).
 *  - mobil (salt görüntüleme, dokunmatik cihaz): açılışta tüm sahne döşemeye bir kez pişirilir, sonra yalnız
 *    döşenir; pişirme sırasında kısa bir "Hazırlanıyor…" göstergesi.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FabricSpec } from '../render-engine';
import {
  createRealisticRenderer,
  fixedLevel,
  initialAutoQuality,
  isRealisticSupported,
  PERF_LADDER,
  stepAutoQuality,
  type AutoQualityState,
  type Quality,
  type RealisticRenderer,
} from '../realistic';
import { fabricInputFromSpec } from '../realistic/adapters/fromSpec';

export type QualityPref = Quality | 'auto';
/** Gerçekçi görünümde boşlukların zemini (fix-v3): koyu gri, siyah, arkadan ışık (perde ışık geçirgenliği). */
export type BackgroundPref = 'darkgray' | 'black' | 'backlight';

export interface RealisticLayerProps {
  spec: FabricSpec;
  seed: number;
  densities: 'loom' | 'finished';
  rect: { left: number; top: number; width: number; height: number };
  originMm: [number, number];
  pxPerMm: number;
  loupe: boolean;
  quality: QualityPref;
  /** Boşluk zemini; verilmezse koyu gri. */
  background?: BackgroundPref;
  onState: (s: { ok: boolean; text: string }) => void;
  /** Verilmezse dokunmatik (pointer: coarse) cihazda 'mobile', aksi hâlde 'desktop'. */
  profile?: 'desktop' | 'mobile';
}

/** Gezinme sayılan ardışık görünüm değişimi aralığı ve hareket sonrası tam kaliteye dönüş gecikmesi. */
const MOTION_MS = 150;

const QUALITY_LABEL: Record<Quality, string> = { low: 'düşük', medium: 'orta', high: 'yüksek' };
const LIGHT = { azimuthDeg: 135, elevationDeg: 45 };

export default function RealisticLayer(p: RealisticLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<RealisticRenderer | null>(null);
  const [ready, setReady] = useState(false);
  const [auto, setAuto] = useState<AutoQualityState>(() => initialAutoQuality());
  const onStateRef = useRef(p.onState);
  onStateRef.current = p.onState;
  const profile = useMemo<'desktop' | 'mobile'>(
    () => p.profile ?? (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches ? 'mobile' : 'desktop'),
    [p.profile],
  );
  const [moving, setMoving] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const lastViewChange = useRef(0);

  // Renderer yaşam döngüsü + sessiz geri dönüş
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    if (!isRealisticSupported()) {
      onStateRef.current({ ok: false, text: '' });
      return;
    }
    try {
      rendererRef.current = createRealisticRenderer(c, {
        measure: 'auto',
        profile,
        onContextLost: () => onStateRef.current({ ok: false, text: '' }),
      });
      setReady(true);
    } catch {
      onStateRef.current({ ok: false, text: '' });
    }
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
      setReady(false);
    };
  }, []);

  const input = useMemo(() => {
    try {
      return { ...fabricInputFromSpec(p.spec, undefined, { densities: p.densities }), seed: p.seed };
    } catch {
      return null;
    }
  }, [p.spec, p.seed, p.densities]);

  const level = p.quality === 'auto' ? PERF_LADDER[auto.level] : fixedLevel(p.quality);
  const { left, top, width, height } = p.rect;

  // Masaüstü ilerleyen kalite: ardışık görünüm değişiminde yarım çözünürlük, durunca tam
  useEffect(() => {
    if (profile !== 'desktop') return;
    const now = performance.now();
    if (now - lastViewChange.current < MOTION_MS) setMoving(true);
    lastViewChange.current = now;
    const t = setTimeout(() => setMoving(false), MOTION_MS + 10);
    return () => clearTimeout(t);
  }, [profile, p.originMm[0], p.originMm[1], p.pxPerMm]);

  // Mobil: desen / kalite değişince döşeme yeniden pişer → önce göstergeyi boya, sonra render
  const background = p.background ?? 'darkgray';
  const bakeKey = `${level.quality}|${background}`;
  const bakedFor = useRef<{ input: unknown; key: string } | null>(null);
  const needsBake = profile === 'mobile' && (!bakedFor.current || bakedFor.current.input !== input || bakedFor.current.key !== bakeKey);
  useEffect(() => {
    if (needsBake && !preparing) setPreparing(true);
  }, [needsBake, preparing]);
  const scaleNow = level.scale * (moving ? 0.5 : 1);

  useEffect(() => {
    const r = rendererRef.current;
    const c = canvasRef.current;
    if (!ready || !r || !c || !input || width < 2 || height < 2) return;
    let measureTimer = 0;
    let prepTimer = 0;
    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2) * scaleNow;
      const W = Math.max(1, Math.round(width * dpr));
      const H = Math.max(1, Math.round(height * dpr));
      if (c.width !== W || c.height !== H) {
        c.width = W;
        c.height = H;
      }
      try {
        r.render(input, {
          pxPerCm: p.pxPerMm * 10 * (W / width),
          offsetCm: [p.originMm[0] / 10, p.originMm[1] / 10],
          light: LIGHT,
          quality: level.quality,
          tuning: { background },
        });
      } catch {
        onStateRef.current({ ok: false, text: '' });
        return;
      }
      if (profile === 'mobile') {
        bakedFor.current = { input, key: bakeKey };
        setPreparing(false);
      }
      // Ölçüm (timer sonucu bir iki kare sonra hazır olur)
      measureTimer = window.setTimeout(() => {
        const st = r.stats();
        if (st.contextLost) {
          onStateRef.current({ ok: false, text: '' });
          return;
        }
        const ms = st.gpuMs;
        const how = st.method === 'timer' ? 'GPU' : st.method === 'sync' ? 'kaba' : '';
        const lvl = scaleNow < 1 ? `${QUALITY_LABEL[level.quality]} ×${scaleNow}` : QUALITY_LABEL[level.quality];
        const bake = st.tile ? ` · döşeme ${st.tile.mm[0].toFixed(1)}×${st.tile.mm[1].toFixed(1)} mm` : '';
        onStateRef.current({
          ok: true,
          text: `Gerçekçi${p.loupe ? ' büyüteç' : ''}${profile === 'mobile' ? ' (mobil)' : ''} · ${p.quality === 'auto' ? 'oto ' : ''}${lvl}${ms !== null ? ` · ${ms.toFixed(1)} ms ${how}` : ''}${bake}`,
        });
        // Hareket sırasındaki yarım çözünürlük kareleri otomatik kaliteyi düşürmesin
        if (p.quality === 'auto' && ms !== null && !moving) {
          setAuto((a) => {
            const n = stepAutoQuality(a, ms);
            return n.level === a.level && n.avgMs === a.avgMs ? a : n;
          });
        }
      }, 80);
    };
    // Mobilde pişirme gerekiyorsa gösterge önce boyansın diye kısa gecikme
    let raf = 0;
    if (needsBake) prepTimer = window.setTimeout(() => (raf = requestAnimationFrame(draw)), 30);
    else raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(measureTimer);
      clearTimeout(prepTimer);
    };
    // level nesnesi her render'da yenidir; içeriği quality + scale
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, input, width, height, p.pxPerMm, p.originMm[0], p.originMm[1], level.quality, scaleNow, p.loupe, p.quality, profile, background]);

  const hidden = width < 2 || height < 2;
  return (
    <>
      <canvas
        ref={canvasRef}
        className={`real-layer${p.loupe ? ' loupe' : ''}`}
        style={{ left, top, width, height, display: hidden ? 'none' : undefined }}
        aria-hidden="true"
      />
      {preparing && !hidden && (
        <div className="real-preparing" style={{ left: left + width / 2, top: top + height / 2 }}>
          Hazırlanıyor…
        </div>
      )}
    </>
  );
}
