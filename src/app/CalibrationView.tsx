/// <reference types="vite/client" />
/**
 * Kalibrasyon görünümü (Faz 5): gerçek numune fotoğrafı ile gerçekçi render'ı aynı ölçekte karşılaştırır.
 * Bu dosya App'ten lazy yüklenir; gerçekçi modül de yalnız bu parçayla birlikte gelir.
 *
 *  - Fotoğraf yerelde açılır (FileReader / object URL), hiçbir yere gönderilmez.
 *  - Ölçek: px/cm elle ya da fotoğrafta bilinen uzaklıktaki iki nokta işaretlenerek.
 *  - Karşılaştırma: yan yana ya da perde (sürgülü bölme). Sürükle = ikisini birlikte kaydır,
 *    Shift + sürükle = yalnız simülasyonu kaydır (desen fazını hizalamak için), tekerlek = yakınlaştır.
 *  - Ayarlar: ışık, AO, speküler, tüylülük, düzensizlik + seçili iplik tipinin yüzeyi.
 *  - Preset'ler iplik tipi bazında JSON olarak indirilir / yüklenir.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { FabricSpec } from '../render-engine';
import { SLOT_NAMES } from '../render-engine';
import {
  applySurfaces,
  createRealisticRenderer,
  releaseContextWhenDetached,
  DEFAULT_TUNING,
  DEFAULT_TWIST_PER_M,
  isRealisticSupported,
  matchingYarnTypes,
  parsePreset,
  photoRect,
  scaleFromPoints,
  serializePreset,
  simView,
  zoomAt,
  type CalibView,
  type Luster,
  type Point,
  type Quality,
  type RealisticPreset,
  type RealisticRenderer,
  type YarnSurface,
} from '../realistic';
import { fabricInputFromSpec } from '../realistic/adapters/fromSpec';
import { DEFAULT_PACKING, PACK_KIND_LABEL, packKind, type PackingParams, type PackKind } from '../realistic/packing';
import { Slider } from './Controls';

/**
 * calibration/photos/ klasöründeki gerçek kumaş makro fotoğrafları (geliştirmede ve build'de URL olarak). Aynı adlı
 * .json yan dosya { "pxPerCm": 1180 } ölçeği verir; yoksa ölçek elle / iki noktayla girilir.
 */
const FOLDER_PHOTOS = import.meta.glob('/calibration/photos/*.{jpg,jpeg,png,webp,JPG,JPEG,PNG}', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const FOLDER_SIDECARS = import.meta.glob('/calibration/photos/*.json', { import: 'default', eager: true }) as Record<string, { pxPerCm?: number }>;
const folderPhotos = Object.entries(FOLDER_PHOTOS)
  .map(([path, url]) => {
    const name = path.split('/').pop()!;
    const side = FOLDER_SIDECARS[path.replace(/\.[^.]+$/, '.json')];
    return { name, url, pxPerCm: side?.pxPerCm };
  })
  .sort((a, b) => a.name.localeCompare(b.name));
const clonePacking = (p: PackingParams): PackingParams => ({
  kinds: Object.fromEntries(Object.entries(p.kinds).map(([k, v]) => [k, { ...v }])) as PackingParams['kinds'],
  compression: p.compression,
});

const MIN_S = 20; // px/cm
const MAX_S = 20000;
const LUSTER_LABEL: Record<Luster, string> = { mat: 'Mat', yarimat: 'Yarı mat', parlak: 'Parlak' };

interface Photo {
  url: string;
  name: string;
  width: number;
  height: number;
}

type Tune = RealisticPreset['tuning'];

function download(name: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function slug(s: string) {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/ı/g, 'i')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'preset'
  );
}

/** Element boyutu (CSS px). */
function useSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

export default function CalibrationView({ spec, seed }: { spec: FabricSpec; seed: number }) {
  const supported = useMemo(() => isRealisticSupported(), []);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [photoPxPerCm, setPhotoPxPerCm] = useState(1000);
  const [marking, setMarking] = useState<null | { a?: Point }>(null);
  const [markDistCm, setMarkDistCm] = useState(1);
  const [marks, setMarks] = useState<Point[]>([]);
  const [cmp, setCmp] = useState<'side' | 'curtain'>('side');
  const [split, setSplit] = useState(0.5);
  const [view, setView] = useState<CalibView>({ screenPxPerCm: 400, x0Cm: 0, y0Cm: 0, simShiftCm: [0, 0] });
  const [light, setLight] = useState({ azimuthDeg: 135, elevationDeg: 45 });
  const [tuning, setTuning] = useState<Tune>({ ...DEFAULT_TUNING });
  const [packing, setPacking] = useState<PackingParams>(() => clonePacking(DEFAULT_PACKING));
  const [quality, setQuality] = useState<Quality>('high');
  const [overrides, setOverrides] = useState<Record<number, YarnSurface>>({});
  const [selType, setSelType] = useState(0);
  const [presetName, setPresetName] = useState('');
  const [msg, setMsg] = useState('');
  const [ms, setMs] = useState<number | null>(null);

  const photoInput = useRef<HTMLInputElement>(null);
  const presetInput = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const simPaneRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<RealisticRenderer | null>(null);
  const stage = useSize(stageRef);
  const simPane = useSize(simPaneRef);

  // Kumaş girdisi: uygulamadaki FabricSpec + iplik tipi yüzey ayarları + tohum
  const base = useMemo(() => {
    try {
      return fabricInputFromSpec(spec);
    } catch {
      return null;
    }
  }, [spec]);
  const input = useMemo(() => (base ? { ...applySurfaces(base, overrides), seed } : null), [base, overrides, seed]);
  const typeLabels = useMemo(() => {
    const nW = spec.warpSlots.length;
    return (input?.yarnTypes ?? []).map((y, i) =>
      i < nW ? `Çözgü ${SLOT_NAMES[i]} — ${y.unit} ${y.count}` : `Atkı ${SLOT_NAMES[i - nW]} — ${y.unit} ${y.count}`,
    );
  }, [input, spec.warpSlots.length]);
  const sel = Math.min(selType, Math.max(0, (input?.yarnTypes.length ?? 1) - 1));
  const selYarn = input?.yarnTypes[sel];

  // Renderer yaşam döngüsü
  useEffect(() => {
    if (!supported || !canvasRef.current) return;
    const cv = canvasRef.current;
    try {
      rendererRef.current = createRealisticRenderer(cv);
    } catch (e) {
      setMsg('WebGL2 başlatılamadı: ' + (e as Error).message);
    }
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
      releaseContextWhenDetached(cv);
    };
  }, [supported]);

  // Render (değişiklikte bir kare)
  useEffect(() => {
    const r = rendererRef.current;
    const c = canvasRef.current;
    if (!r || !c || !input || simPane.w < 2 || simPane.h < 2) return;
    const raf = requestAnimationFrame(() => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = Math.round(simPane.w * dpr);
      const H = Math.round(simPane.h * dpr);
      if (c.width !== W || c.height !== H) {
        c.width = W;
        c.height = H;
      }
      const t0 = performance.now();
      try {
        r.render(input, simView(view, simPane.h, W / simPane.w, { light, quality, tuning: { ...tuning, packing } }));
        setMs(performance.now() - t0);
      } catch (e) {
        setMsg('Render hatası: ' + (e as Error).message);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [input, view, light, quality, tuning, packing, simPane.w, simPane.h]);

  /* ------------------------------ fotoğraf ------------------------------ */

  const showPhoto = (url: string, name: string, pxPerCm?: number) => {
    const img = new Image();
    img.onload = () => {
      const scale = pxPerCm && pxPerCm > 0 ? pxPerCm : photoPxPerCm;
      if (pxPerCm && pxPerCm > 0) setPhotoPxPerCm(pxPerCm);
      setPhoto({ url, name, width: img.naturalWidth, height: img.naturalHeight });
      setMarks([]);
      // Fotoğrafın genişliği panele sığsın
      const paneW = cmp === 'side' ? stage.w / 2 : stage.w;
      if (paneW > 0) {
        const s = Math.min(MAX_S, Math.max(MIN_S, paneW / (img.naturalWidth / scale)));
        setView((v) => ({ ...v, screenPxPerCm: s, x0Cm: 0, y0Cm: 0 }));
      }
      setMsg(`Fotoğraf: ${name} (${img.naturalWidth}×${img.naturalHeight} px${pxPerCm ? `, ölçek ${pxPerCm} px/cm yan dosyadan` : ''})`);
    };
    img.onerror = () => setMsg('Görüntü açılamadı.');
    img.src = url;
  };
  const loadPhoto = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => showPhoto(String(reader.result), file.name);
    reader.readAsDataURL(file);
  };
  // Kumaştaki iplik tiplerinin paketleme sınıfları (kaydırıcılar yalnız bunlar için)
  const kindsInUse = useMemo(() => {
    const set = new Set<PackKind>();
    for (const y of input?.yarnTypes ?? []) set.add(packKind(y.structure, y.plies ?? 2));
    return [...set];
  }, [input]);
  const setKind = (k: PackKind, patch: Partial<PackingParams['kinds'][PackKind]>) =>
    setPacking((p) => ({ ...p, kinds: { ...p.kinds, [k]: { ...p.kinds[k], ...patch } } }));

  /* --------------------------- etkileşim (ortak) --------------------------- */

  const drag = useRef<null | { x: number; y: number; kind: 'pan' | 'shift' | 'split'; v: CalibView }>(null);
  const local = (e: { clientX: number; clientY: number }, el: Element) => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width };
  };

  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    const p = local(e, e.currentTarget);
    if (marking && photo) {
      const pt = { x: (view.x0Cm + p.x / view.screenPxPerCm) * photoPxPerCm, y: (view.y0Cm + p.y / view.screenPxPerCm) * photoPxPerCm };
      if (!marking.a) {
        setMarking({ a: pt });
        setMarks([pt]);
      } else {
        try {
          const s = scaleFromPoints(marking.a, pt, markDistCm);
          setPhotoPxPerCm(+s.toFixed(2));
          setMarks([marking.a, pt]);
          setMsg(`Ölçek: ${s.toFixed(1)} px/cm (${markDistCm} cm = ${(s * markDistCm).toFixed(1)} px)`);
        } catch (err) {
          setMsg((err as Error).message);
          setMarks([]);
        }
        setMarking(null);
      }
      return;
    }
    const nearSplit = cmp === 'curtain' && Math.abs(p.x - split * p.w) < 10;
    drag.current = { x: e.clientX, y: e.clientY, kind: nearSplit ? 'split' : e.shiftKey ? 'shift' : 'pan', v: view };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'split') {
      const p = local(e, e.currentTarget);
      setSplit(Math.min(1, Math.max(0, p.x / p.w)));
      return;
    }
    const dx = (e.clientX - d.x) / d.v.screenPxPerCm;
    const dy = (e.clientY - d.y) / d.v.screenPxPerCm;
    if (d.kind === 'pan') setView({ ...d.v, x0Cm: d.v.x0Cm - dx, y0Cm: d.v.y0Cm - dy });
    else setView({ ...d.v, simShiftCm: [d.v.simShiftCm[0] + dx, d.v.simShiftCm[1] + dy] });
  };
  const onUp = () => {
    drag.current = null;
  };

  // Tekerlek: pasif olmayan dinleyici (sayfa kaymasın)
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const pane = (e.target as Element).closest('.calib-pane') ?? el;
      const p = local(e, pane);
      setView((v) => zoomAt(v, p, Math.exp(-e.deltaY * 0.0015), MIN_S, MAX_S));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /* ------------------------------ preset'ler ------------------------------ */

  const surfaceOf = (i: number): YarnSurface | null => {
    const y = input?.yarnTypes[i];
    if (!y) return null;
    return { luster: y.luster, hairiness: y.hairiness, twistPerM: y.twistPerM ?? DEFAULT_TWIST_PER_M };
  };
  const setSurface = (patch: Partial<YarnSurface>) => {
    const cur = surfaceOf(sel);
    if (!cur) return;
    setOverrides((o) => ({ ...o, [sel]: { ...cur, ...patch } }));
  };

  const savePreset = () => {
    const y = input?.yarnTypes[sel];
    const surface = surfaceOf(sel);
    if (!y || !surface) return;
    const name = presetName.trim() || `${y.unit} ${y.count} ${LUSTER_LABEL[surface.luster]}`;
    const p: RealisticPreset = {
      version: 1,
      name,
      yarn: { count: y.count, unit: y.unit },
      surface,
      light: { ...light },
      tuning: { ...tuning },
      packing: clonePacking(packing),
      quality,
      ...(photo ? { photoPxPerCm } : {}),
    };
    download(`preset-${slug(name)}.json`, serializePreset(p));
    setMsg(`Preset indirildi: ${name}`);
  };

  const loadPreset = async (file: File) => {
    try {
      const p = parsePreset(await file.text());
      setLight({ ...p.light });
      setTuning({ ...p.tuning });
      setPacking(clonePacking(p.packing ?? DEFAULT_PACKING));
      if (p.quality) setQuality(p.quality);
      setPresetName(p.name);
      const idx = input ? matchingYarnTypes(input, p.yarn) : [];
      if (idx.length) {
        setOverrides((o) => {
          const n = { ...o };
          for (const i of idx) n[i] = { ...p.surface };
          return n;
        });
        setSelType(idx[0]);
        setMsg(`Preset yüklendi: ${p.name} → ${idx.map((i) => typeLabels[i]).join(', ')}`);
      } else {
        setMsg(`Preset yüklendi: ${p.name}. ${p.yarn.unit} ${p.yarn.count} kumaşta yok; yalnız ışık / görünüm ayarları uygulandı.`);
      }
    } catch (e) {
      setMsg('Preset hatası: ' + (e as Error).message);
    }
  };

  /* -------------------------------- çizim -------------------------------- */

  const pr = photo ? photoRect(view, { ...photo, pxPerCm: photoPxPerCm }) : null;
  const photoLayer = (
    <>
      {photo && pr ? (
        <img
          className="calib-photo"
          src={photo.url}
          alt="Numune fotoğrafı"
          draggable={false}
          style={{ left: pr.left, top: pr.top, width: pr.width, height: pr.height }}
        />
      ) : (
        <div className="calib-empty">Numune fotoğrafı yükleyin</div>
      )}
      {marks.map((m, k) => (
        <span
          key={k}
          className="calib-mark"
          style={{
            left: (m.x / photoPxPerCm - view.x0Cm) * view.screenPxPerCm,
            top: (m.y / photoPxPerCm - view.y0Cm) * view.screenPxPerCm,
          }}
        />
      ))}
    </>
  );
  const barMm = view.screenPxPerCm >= 2000 ? 0.5 : view.screenPxPerCm >= 400 ? 1 : view.screenPxPerCm >= 80 ? 5 : 10;
  const scaleBar = (
    <div className="calib-bar">
      <span style={{ width: (barMm / 10) * view.screenPxPerCm }} />
      {barMm} mm
    </div>
  );
  const shift = view.simShiftCm[0] !== 0 || view.simShiftCm[1] !== 0;

  return (
    <div className="calib">
      <aside className="calib-side">
        <section className="panel">
          <h3>Numune fotoğrafı</h3>
          <input
            ref={photoInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) loadPhoto(f);
              e.target.value = '';
            }}
          />
          <button onClick={() => photoInput.current?.click()}>Fotoğraf yükle…</button>
          <label className="numfield">
            <span>calibration/photos/</span>
            <select
              value=""
              onChange={(e) => {
                const f = folderPhotos.find((x) => x.name === e.target.value);
                if (f) showPhoto(f.url, f.name, f.pxPerCm);
              }}
            >
              <option value="">{folderPhotos.length ? `Klasörden seç (${folderPhotos.length})…` : 'Klasörde fotoğraf yok'}</option>
              {folderPhotos.map((f) => (
                <option key={f.name} value={f.name}>
                  {f.name}
                  {f.pxPerCm ? ` · ${f.pxPerCm} px/cm` : ''}
                </option>
              ))}
            </select>
          </label>
          <div className="row">
            <label className="numfield">
              <span>Fotoğraf ölçeği</span>
              <span className="numfield-input">
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={photoPxPerCm}
                  onChange={(e) => {
                    const v = +e.target.value;
                    if (v >= 1) setPhotoPxPerCm(v);
                  }}
                />
                <em>px/cm</em>
              </span>
            </label>
          </div>
          <div className="row">
            <label className="numfield">
              <span>Bilinen uzaklık</span>
              <span className="numfield-input">
                <input type="number" min={0.01} step={0.1} value={markDistCm} onChange={(e) => +e.target.value > 0 && setMarkDistCm(+e.target.value)} />
                <em>cm</em>
              </span>
            </label>
            <button disabled={!photo} className={marking ? 'on' : ''} onClick={() => setMarking(marking ? null : {})}>
              {marking ? (marking.a ? '2. noktayı işaretleyin…' : '1. noktayı işaretleyin…') : 'İki nokta ile ölç'}
            </button>
          </div>
          <p className="hint">
            Örn. fotoğraftaki cetvelde 1 cm aralıklı iki çizgiye tıklayın. Fotoğraf yalnız bu tarayıcıda açılır, bir yere gönderilmez.
          </p>
        </section>

        <section className="panel">
          <h3>Işık</h3>
          <Slider label="Azimut" value={light.azimuthDeg} min={0} max={360} step={1} format={(v) => `${v}°`} onChange={(v) => setLight((l) => ({ ...l, azimuthDeg: v }))} />
          <Slider label="Yükseklik" value={light.elevationDeg} min={5} max={90} step={1} format={(v) => `${v}°`} onChange={(v) => setLight((l) => ({ ...l, elevationDeg: v }))} />
        </section>

        <section className="panel">
          <h3>Paketleme</h3>
          <p className="hint">
            İplik komşusuna ya da hücre sınırına kadar yassılaşıp genişler (hacim korunur). En/boy: tipin en fazla yayılması;
            doldurma: hücrenin en fazla ne kadarı dolar. Açıklık metriği de bu modelden.
          </p>
          {kindsInUse.map((k) => (
            <div key={k}>
              <b className="small">{PACK_KIND_LABEL[k]}</b>
              <Slider label="En büyük en/boy" value={packing.kinds[k].maxAspect} min={1} max={6} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => setKind(k, { maxAspect: v })} />
              <Slider label="Doldurma oranı" value={packing.kinds[k].fill} min={0.3} max={1} step={0.01} format={(v) => '%' + Math.round(v * 100)} onChange={(v) => setKind(k, { fill: v })} />
            </div>
          ))}
          <Slider label="Sıkışma katsayısı" value={packing.compression} min={0.5} max={1} step={0.01} format={(v) => v.toFixed(2)} onChange={(v) => setPacking((p) => ({ ...p, compression: v }))} />
          <button className="link" onClick={() => setPacking(clonePacking(DEFAULT_PACKING))}>
            Varsayılana dön
          </button>
        </section>

        <section className="panel">
          <h3>Yüzey ayarları</h3>
          <Slider label="AO şiddeti" value={tuning.aoStrength} min={0} max={2} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => setTuning((t) => ({ ...t, aoStrength: v }))} />
          <Slider label="Speküler şiddet" value={tuning.specularStrength} min={0} max={3} step={0.05} format={(v) => '×' + v.toFixed(2)} onChange={(v) => setTuning((t) => ({ ...t, specularStrength: v }))} />
          <Slider label="Speküler genişlik" value={tuning.specularWidth} min={0.25} max={4} step={0.05} format={(v) => '×' + v.toFixed(2)} onChange={(v) => setTuning((t) => ({ ...t, specularWidth: v }))} />
          <Slider label="Tüylülük" value={tuning.hairiness} min={0} max={3} step={0.05} format={(v) => '×' + v.toFixed(2)} onChange={(v) => setTuning((t) => ({ ...t, hairiness: v }))} />
          <Slider label="Düzensizlik" value={tuning.irregularity} min={0} max={4} step={0.05} format={(v) => '×' + v.toFixed(2)} onChange={(v) => setTuning((t) => ({ ...t, irregularity: v }))} />
          <div className="row">
            <label>
              Kalite
              <select value={quality} onChange={(e) => setQuality(e.target.value as Quality)}>
                <option value="low">Düşük</option>
                <option value="medium">Orta</option>
                <option value="high">Yüksek</option>
              </select>
            </label>
            <button onClick={() => setTuning({ ...DEFAULT_TUNING })}>Varsayılana dön</button>
          </div>
        </section>

        <section className="panel">
          <h3>İplik tipi</h3>
          <select value={sel} onChange={(e) => setSelType(+e.target.value)}>
            {typeLabels.map((l, i) => (
              <option key={i} value={i}>
                {l}
                {overrides[i] ? ' •' : ''}
              </option>
            ))}
          </select>
          {selYarn && (
            <>
              <div className="seg">
                {(['mat', 'yarimat', 'parlak'] as Luster[]).map((l) => (
                  <button key={l} className={selYarn.luster === l ? 'on' : ''} onClick={() => setSurface({ luster: l })}>
                    {LUSTER_LABEL[l]}
                  </button>
                ))}
              </div>
              <Slider label="Tüylülük (iplik)" value={selYarn.hairiness} min={0} max={1} step={0.01} format={(v) => v.toFixed(2)} onChange={(v) => setSurface({ hairiness: v })} />
              <Slider
                label="Büküm"
                value={selYarn.twistPerM ?? DEFAULT_TWIST_PER_M}
                min={0}
                max={1500}
                step={10}
                format={(v) => `${v} tur/m ${selYarn.twist}`}
                onChange={(v) => setSurface({ twistPerM: v })}
              />
              {overrides[sel] && (
                <button
                  className="link"
                  onClick={() =>
                    setOverrides((o) => {
                      const n = { ...o };
                      delete n[sel];
                      return n;
                    })
                  }
                >
                  Bu iplik tipini sıfırla
                </button>
              )}
            </>
          )}
        </section>

        <section className="panel">
          <h3>Preset (iplik tipi bazında)</h3>
          <input placeholder="Preset adı (ör. Pamuk Ne 20 — numune A)" value={presetName} onChange={(e) => setPresetName(e.target.value)} />
          <div className="row">
            <button onClick={savePreset} disabled={!selYarn}>
              JSON indir
            </button>
            <input
              ref={presetInput}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) loadPreset(f);
                e.target.value = '';
              }}
            />
            <button onClick={() => presetInput.current?.click()}>JSON yükle…</button>
          </div>
          <p className="hint">
            Preset, seçili iplik tipinin yüzeyini (parlaklık, tüylülük, büküm) ve ışık / AO / speküler / düzensizlik ayarlarını taşır.
            Yüklenince aynı numaradaki tüm iplik tiplerine uygulanır.
          </p>
        </section>
      </aside>

      <main className="calib-main">
        <div className="view-bar">
          <div className="seg">
            <button className={cmp === 'side' ? 'on' : ''} onClick={() => setCmp('side')}>
              Yan yana
            </button>
            <button className={cmp === 'curtain' ? 'on' : ''} onClick={() => setCmp('curtain')}>
              Perde
            </button>
          </div>
          <span className="muted">
            {view.screenPxPerCm.toFixed(0)} px/cm ekranda · {(10 / view.screenPxPerCm).toFixed(3)} mm/px
            {ms !== null && ` · ${ms.toFixed(1)} ms`}
          </span>
          {shift && (
            <button onClick={() => setView((v) => ({ ...v, simShiftCm: [0, 0] }))}>
              Simülasyon kaymasını sıfırla ({(view.simShiftCm[0] * 10).toFixed(2)}, {(view.simShiftCm[1] * 10).toFixed(2)} mm)
            </button>
          )}
          <span className="muted">Sürükle: kaydır · Shift + sürükle: yalnız simülasyon · tekerlek: yakınlaştır</span>
        </div>
        {msg && <div className="calib-msg">{msg}</div>}
        {!supported && <div className="calib-msg">Bu tarayıcıda WebGL2 (kayan nokta hedefleri) yok; gerçekçi render gösterilemiyor.</div>}
        <div
          ref={stageRef}
          className={`calib-stage ${cmp}${marking ? ' marking' : ''}`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          <div className="calib-pane photo">
            {photoLayer}
            {cmp === 'side' && <span className="calib-tag">Fotoğraf</span>}
            {cmp === 'side' && scaleBar}
          </div>
          <div
            ref={simPaneRef}
            className="calib-pane sim"
            style={cmp === 'curtain' ? { clipPath: `inset(0 0 0 ${split * 100}%)` } : undefined}
          >
            <canvas ref={canvasRef} />
            {cmp === 'side' && <span className="calib-tag">Simülasyon</span>}
          </div>
          {cmp === 'curtain' && (
            <>
              <div className="calib-split" style={{ left: `${split * 100}%` }} />
              <span className="calib-tag">Fotoğraf</span>
              <span className="calib-tag right">Simülasyon</span>
              {scaleBar}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
