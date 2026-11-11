import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildFabricPositions,
  computeMetrics,
  mapLoomToFinished,
  lcm,
  slotOf,
  structureMetrics,
  withThreading,
  type FabricSpec,
} from '../render-engine';
import type { PhysicalInfo } from '../render-engine/worker';
import { parseWif } from '../importers/wif';
import { parseFabricJson, serializeFabricJson } from '../importers/fabricJson';
import { atkiJsonImporter } from '../importers/atkiJson';
import { atkiJsonToFabricSpec, VARSAYILAN_SECENEKLER, type AtkiSecenekler } from '../adapters/atkiJson';
import { DEMO_DESENLER, type AtkiBelge } from './demoDesenler';
import { colorsToSlots } from '../importers/slots';
import { physicalExample } from '../presets/physicalExample';
import { FabricPanel, YarnPanel } from './Controls';
import { FabricPane, LOUPE_ZOOM, MAX_PPM, MIN_PPM, REALISTIC_FULL_PPM, type MmView, type MmWindow, type ReedStripInfo } from './FabricPane';
import { MetricsBar } from './MetricsBar';
import { RenderClient, imageToCanvas } from './renderClient';
import { WeaveEditor } from './WeaveEditor';
import { ThreadingEditor } from './ThreadingEditor';
import type { BackgroundPref, DistancePref, QualityPref } from './RealisticLayer';
import { CARD_WIDTH_MM, cssPxPerMm } from '../realistic/viewDistance';

/** .atki.json çekme taşımaz; demo / içe aktarma yüklemesinde varsayılan çekme (VARSAYIM: çözgü boy %6, atkı en %10). */
const DEMO_SHRINK = { warpPct: 6, weftPct: 10 };

/** Ekran kalibrasyonu (CSS px / mm çarpanı) bu tarayıcıda saklanır; yoksa 96 dpi varsayımı (1). */
const CALIB_KEY = 'dokuma.ekranKalibrasyonu';
function loadCalib(): number {
  try {
    const v = parseFloat(localStorage.getItem(CALIB_KEY) ?? '');
    return v > 0.3 && v < 3 ? v : 1;
  } catch {
    return 1;
  }
}

/** Kalibrasyon görünümü ve gerçekçi render modülü ayrı parça olarak, ilk açılışta yüklenir. */
const CalibrationView = lazy(() => import('./CalibrationView'));

/** PNG dışa aktarmada izin verilen en büyük piksel sayısı. */
const MAX_EXPORT_PIXELS = 40_000_000;
const AREAS_MM = [5, 10, 20];

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function download(name: string, blob: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function App() {
  const [spec, setSpec] = useState<FabricSpec>(() => physicalExample(6, 10));
  const [seed, setSeed] = useState(3);
  const [mode, setMode] = useState<'single' | 'compare'>('compare');
  const [compareKind, setCompareKind] = useState<'sameYarns' | 'sameArea' | 'physicalArea'>('sameYarns');
  const [showStrips, setShowStrips] = useState(false);
  const [showLinks, setShowLinks] = useState(true);
  const [showWeftLinks, setShowWeftLinks] = useState(false);
  const [view, setView] = useState<MmView>({ x0Mm: 0, y0Mm: 0, pxPerMm: 60 });
  const [paneSize, setPaneSize] = useState({ w: 0, h: 0 });
  const [info, setInfo] = useState<PhysicalInfo | null>(null);
  const [message, setMessage] = useState('');
  const [exportScale, setExportScale] = useState(2);
  const [exporting, setExporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const fitted = useRef(false);
  const [page, setPage] = useState<'sim' | 'calib'>('sim');
  // Faz 6: gerçekçi görünüm (varsayılan kapalı; destek yoksa düğme sessizce devre dışı kalır)
  const [realOn, setRealOn] = useState(false);
  const [realQuality, setRealQuality] = useState<QualityPref>('auto');
  // Zemin: kullanıcı elle seçmediyse moda göre (Göz / Uzak 'açık' — arkası aydınlık perde; Lup 'koyu gri');
  // elle seçildiyse mod değişince korunur
  const [userBackground, setUserBackground] = useState<BackgroundPref | null>(null);
  // Bakış mesafesi (zoom'dan ayrı): Göz / Uzak fiziksel ölçek + ön filtre, Lup gerçekçi yakın görünüm
  const [distance, setDistance] = useState<DistancePref>('eye');
  // Yakın (tam gerçekçi lup) zemini: Lup koyu gri, Göz / Uzak açık. Uzak görünüm zemini her modda Göz zemini (açık):
  // Lup uzaklaşınca koyu zemin yerine Göz zemini. Elle seçilen zemin ikisinde de geçerli.
  const realBackground: BackgroundPref = userBackground ?? (distance === 'loupe' ? 'darkgray' : 'light');
  const farBackground: BackgroundPref = userBackground ?? 'light';
  const [screenCalib, setScreenCalib] = useState(loadCalib);
  const physPpm = cssPxPerMm(screenCalib);
  const [realUnavailable, setRealUnavailable] = useState(false);
  // Yüklü .atki.json belgesi (demo ya da içe aktarılan): varyant / seçenek değişince desen yeniden açılır
  const [atki, setAtki] = useState<{ key: string; belge: AtkiBelge; varyant: number; secenekler: AtkiSecenekler } | null>(null);
  const onRealUnavailable = useCallback(() => {
    setRealUnavailable(true);
    setRealOn(false);
  }, []);
  const realistic = useMemo(
    () =>
      realOn && !realUnavailable
        ? { quality: realQuality, background: realBackground, farBackground, distance, densities: 'finished' as const, onUnavailable: onRealUnavailable }
        : undefined,
    [realOn, realUnavailable, realQuality, realBackground, farBackground, distance, onRealUnavailable],
  );
  const [calibOpened, setCalibOpened] = useState(false);

  const debSpec = useDebounced(spec, 60);
  const loomSpec = useMemo(() => ({ ...debSpec, warpShrinkPct: 0, weftShrinkPct: 0 }), [debSpec]);

  const metrics = useMemo(() => {
    try {
      return computeMetrics(spec);
    } catch {
      return null;
    }
  }, [spec]);
  const structure = useMemo(() => {
    try {
      return structureMetrics(spec);
    } catch {
      return null;
    }
  }, [spec]);
  const positions = useMemo(() => {
    try {
      return buildFabricPositions(debSpec);
    } catch {
      return null;
    }
  }, [debSpec]);

  const onSize = useCallback((w: number, h: number) => setPaneSize({ w, h }), []);
  const setArea = useCallback(
    (mm: number) => setView((v) => ({ ...v, pxPerMm: Math.max(MIN_PPM, Math.min(MAX_PPM, paneSize.w / mm)) })),
    [paneSize.w],
  );
  // Bakış modu bir filtredir, ölçek değil: zoom her modda serbest. "Gerçek boyut" ayrı bir zoom ön ayarı (ekran
  // kalibrasyonuyla: ekranda 1 mm = kumaşta 1 mm).
  const setRealSize = useCallback(() => setView((v) => ({ ...v, pxPerMm: physPpm })), [physPpm]);
  const realSizeOn = Math.abs(view.pxPerMm - physPpm) < physPpm * 0.005;
  // İlk ölçümde 10 mm göster
  useEffect(() => {
    if (fitted.current || paneSize.w < 100) return;
    fitted.current = true;
    setArea(10);
  }, [paneSize.w, setArea]);
  const shownMm = (paneSize.w || 600) / view.pxPerMm;

  // "Aynı iplikler": tezgah penceresindeki ipliklerin mamuldeki (daralmış) penceresi.
  // "Aynı alan": iki panel AYNI boyutta (mm) ve üst kenarı AYNI atkıdan başlar — hizalama noktası sabit (tezgah
  // penceresinin üst kenarındaki atkı → mamuldeki konumu); çekme yüzünden bant sınırları kaymaz, yalnız alt kısım
  // (daha çok / az atkı) farklılaşır. "Fiziksel alan": eski davranış (aynı mm koordinatı, hizasız).
  const finishedWindow = useMemo<MmWindow | undefined>(() => {
    if (mode !== 'compare' || (compareKind !== 'sameYarns' && compareKind !== 'sameArea') || !positions || paneSize.w === 0) {
      return undefined;
    }
    const x1 = view.x0Mm + paneSize.w / view.pxPerMm;
    const y1 = view.y0Mm + paneSize.h / view.pxPerMm;
    if (compareKind === 'sameArea') {
      const loomH = paneSize.h / view.pxPerMm;
      const loomW = paneSize.w / view.pxPerMm;
      const fTop = mapLoomToFinished(positions.weft, y1);
      return { x0Mm: view.x0Mm, y0Mm: fTop - loomH, widthMm: loomW, heightMm: loomH };
    }
    const fx0 = mapLoomToFinished(positions.warp, view.x0Mm);
    const fy0 = mapLoomToFinished(positions.weft, view.y0Mm);
    return {
      x0Mm: fx0,
      y0Mm: fy0,
      widthMm: mapLoomToFinished(positions.warp, x1) - fx0,
      heightMm: mapLoomToFinished(positions.weft, y1) - fy0,
    };
  }, [mode, compareKind, positions, view, paneSize]);

  // Tarak şeridi (tezgah konumları) ve mamulde bağlantı çizgileri
  const warpColorOf = useCallback(
    (g: number) => debSpec.warpSlots[slotOf(debSpec.warpSequence, g, debSpec.warpSlots.length)]?.color ?? '#888',
    [debSpec],
  );
  const loomStrip = useMemo<ReedStripInfo | undefined>(
    () => (positions?.reed ? { reed: positions.reed, colorOf: warpColorOf } : undefined),
    [positions, warpColorOf],
  );
  const finishedStrip = useMemo<ReedStripInfo | undefined>(() => {
    if (!positions?.reed) return undefined;
    return {
      reed: positions.reed,
      colorOf: warpColorOf,
      finished: showLinks ? positions.warp.finished : undefined,
      loomOriginX: view.x0Mm,
    };
  }, [positions, warpColorOf, showLinks, view.x0Mm]);

  // Rapor tekrar uzunlukları (tel cinsinden)
  const repeats = useMemo(() => {
    const weave = spec.weave[0].length;
    const seq = Math.max(1, spec.warpSequence.length);
    const reedEnds = spec.reed ? spec.reed.dentingReport.reduce((a, b) => a + b, 0) : 0;
    const reedDents = spec.reed ? spec.reed.dentingReport.length : 0;
    let all = lcm(weave, seq);
    if (reedEnds > 0) all = lcm(all, reedEnds);
    const loomPitch = positions ? positions.warp.loom.meanPitchMm() : 10 / spec.warpDensityLoom;
    const finPitch = positions ? positions.warp.finished.meanPitchMm() : loomPitch;
    // Atkı yönü
    const weaveF = spec.weave.length;
    const seqF = Math.max(1, spec.weftSequence.length);
    const reportF = spec.weftDensityReport?.length ?? 0;
    let allF = lcm(weaveF, seqF);
    if (reportF > 0) allF = lcm(allF, reportF);
    const loomPitchF = positions ? positions.weft.loom.meanPitchMm() : 10 / spec.weftDensityLoom;
    const finPitchF = positions ? positions.weft.finished.meanPitchMm() : loomPitchF;
    return {
      weave,
      seq,
      reedEnds,
      reedDents,
      all,
      loomMm: all * loomPitch,
      finMm: all * finPitch,
      weaveF,
      seqF,
      reportF,
      allF,
      loomMmF: allF * loomPitchF,
      finMmF: allF * finPitchF,
    };
  }, [spec, positions]);

  // Atkı bağlantı çizgileri ve çekme etiketi (karşılaştırmada mamul paneli)
  const weftLinks = useMemo(
    () =>
      showWeftLinks && positions
        ? { loom: positions.weft.loom, finished: positions.weft.finished, loomOriginY: view.y0Mm }
        : undefined,
    [showWeftLinks, positions, view.y0Mm],
  );
  const shrinkLabel = useMemo(() => {
    if (!finishedWindow || paneSize.w === 0 || compareKind !== 'sameYarns') return undefined;
    const loomW = paneSize.w / view.pxPerMm;
    const loomH = paneSize.h / view.pxPerMm;
    const boy = 100 * (1 - finishedWindow.heightMm / loomH);
    const en = 100 * (1 - finishedWindow.widthMm / loomW);
    return `boy %${boy.toFixed(1)} kısaldı, en %${en.toFixed(1)} daraldı`;
  }, [finishedWindow, compareKind, paneSize, view.pxPerMm]);

  /** .atki.json belgesini (varyant + seçeneklerle) spec'e açar. Panelde düzenlenmiş iplik tanımları korunur. */
  const openAtki = (next: { key: string; belge: AtkiBelge; varyant: number; secenekler: AtkiSecenekler }, keepYarns: boolean) => {
    try {
      setSpec((s) => {
        const iplikler = keepYarns && s.yarns?.length ? s.yarns : next.belge.iplikler;
        const out = atkiJsonToFabricSpec(next.belge.json, { ...next.belge, iplikler, varyantIndex: next.varyant, secenekler: next.secenekler });
        // önceki desenin tarağı / atkı sıklık raporu bu desene ait değil
        // Çekme: ilk yüklemede varsayılan (çözgü boy %6, atkı en %10 — mamul sıklığı tezgahtan farklı olsun);
        // varyant / seçenek değişiminde kullanıcının değeri korunur
        const shrink = keepYarns
          ? { warpShrinkPct: s.warpShrinkPct, weftShrinkPct: s.weftShrinkPct }
          : { warpShrinkPct: DEMO_SHRINK.warpPct, weftShrinkPct: DEMO_SHRINK.weftPct };
        return { ...s, ...out, ...shrink, reed: undefined, weftDensityReport: undefined };
      });
      setAtki(next);
      const v = next.belge.json.varyasyonlar[next.varyant];
      setMessage(`${next.belge.ad} yüklendi${v ? ' · ' + v.ad : ''}.`);
    } catch (e) {
      setMessage('Desen açılamadı: ' + (e as Error).message);
    }
  };

  const onImport = async (file: File) => {
    try {
      const text = await file.text();
      const name = file.name.toLowerCase();
      if (atkiJsonImporter.accepts(name)) {
        const b = atkiJsonImporter.load(text);
        openAtki({ key: 'dosya:' + file.name, belge: { ...b, ad: b.json.desen.ad || file.name, varyantIndex: 0 }, varyant: 0, secenekler: VARSAYILAN_SECENEKLER }, false);
      } else if (name.endsWith('.wif')) {
        const r = parseWif(text);
        const warnings = [...r.warnings];
        // Tel bazlı model: THREADING → tahar, TIEUP/TREADLING ya da LIFTPLAN → armür (weave bunlardan türetilir)
        const base: FabricSpec = { ...spec, weave: r.weave };
        delete base.threading;
        delete base.liftplan;
        delete base.frames;
        const next: FabricSpec = r.threading && r.liftplan ? withThreading(base, r.threading, r.liftplan, r.frames) : base;
        if (r.warpColors) {
          const w = colorsToSlots(r.warpColors, spec.warpSlots[0], 'Çözgü');
          next.warpSlots = w.slots;
          next.warpSequence = w.sequence;
          warnings.push(...w.warnings);
        }
        if (r.weftColors) {
          const f = colorsToSlots(r.weftColors, spec.weftSlots[0], 'Atkı');
          next.weftSlots = f.slots;
          next.weftSequence = f.sequence;
          warnings.push(...f.warnings);
        }
        setSpec(next);
        setMessage(`WIF yüklendi: ${r.weave[0].length}×${r.weave.length}` + (warnings.length ? ` · ${warnings.join(' ')}` : ''));
      } else {
        const p = parseFabricJson(text);
        setSpec(p.spec);
        setMessage((p.migrated ? 'Eski biçim JSON v2\'ye çevrildi.' : 'FabricSpec JSON yüklendi.') + (p.warnings.length ? ' ' + p.warnings.join(' ') : ''));
      }
    } catch (e) {
      setMessage('İçe aktarma hatası: ' + (e as Error).message);
    }
  };

  const exportPng = async () => {
    const ppm = view.pxPerMm * exportScale;
    const wMm = paneSize.w / view.pxPerMm;
    const hMm = paneSize.h / view.pxPerMm;
    const W = Math.trunc(wMm * ppm);
    const H = Math.trunc(hMm * ppm);
    if (W * H > MAX_EXPORT_PIXELS) {
      setMessage(`Çok büyük: ${W}×${H} px.`);
      return;
    }
    setExporting(true);
    setMessage(`PNG hazırlanıyor (${W}×${H} px)…`);
    const client = new RenderClient();
    try {
      const res = await client.request({
        kind: 'physical',
        spec,
        seed,
        scaleBar: true,
        view: { x0Mm: view.x0Mm, y0Mm: view.y0Mm, widthMm: wMm, heightMm: hMm, pxPerMm: ppm },
      });
      if (!res) throw new Error('render iptal edildi');
      const canvas = imageToCanvas(res.image);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = 'rgb(240,240,240)';
      ctx.font = `${Math.round(15 * exportScale)}px system-ui, sans-serif`;
      ctx.fillText('1 mm', 12, res.image.height - 36);
      const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/png'));
      if (!blob) throw new Error('PNG kodlanamadı');
      download(`dokuma-${wMm.toFixed(1)}mm-${W}x${H}.png`, blob);
      setMessage(`PNG kaydedildi: ${W}×${H} px · ${Math.round(res.ms)} ms`);
    } catch (e) {
      setMessage('PNG hatası: ' + (e as Error).message);
    } finally {
      client.dispose();
      setExporting(false);
    }
  };

  return (
    <div className="app">
      <header className="toolbar">
        <h1>Dokuma Simülatörü</h1>
        <div className="seg">
          <button className={page === 'sim' ? 'on' : ''} onClick={() => setPage('sim')}>
            Simülatör
          </button>
          <button
            className={page === 'calib' ? 'on' : ''}
            onClick={() => {
              setPage('calib');
              setCalibOpened(true);
            }}
          >
            Kalibrasyon
          </button>
        </div>
        <div className="toolbar-actions">
          <input
            ref={fileRef}
            type="file"
            accept=".wif,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImport(f);
              e.target.value = '';
            }}
          />
          <button onClick={() => fileRef.current?.click()}>İçe aktar (WIF / JSON)</button>
          <select
            value={atki && !atki.key.startsWith('dosya:') ? atki.key : ''}
            onChange={(e) => {
              const d = DEMO_DESENLER.find((x) => x.key === e.target.value);
              if (d) openAtki({ key: d.key, belge: d, varyant: d.varyantIndex, secenekler: atki?.secenekler ?? VARSAYILAN_SECENEKLER }, false);
            }}
            title="Tezgah'tan dışa aktarılmış gerçek .atki.json desenleri"
          >
            <option value="">Demo desenler…</option>
            {DEMO_DESENLER.map((d) => (
              <option key={d.key} value={d.key}>
                {d.ad}
              </option>
            ))}
          </select>
          {atki && atki.belge.json.varyasyonlar.length > 1 && (
            <select
              value={atki.varyant}
              onChange={(e) => openAtki({ ...atki, varyant: +e.target.value }, true)}
              title="Kolorway varyantı"
            >
              {atki.belge.json.varyasyonlar.map((v, k) => (
                <option key={k} value={k}>
                  {v.ad}
                </option>
              ))}
            </select>
          )}
          {atki && (
            <details className="atki-gelismis">
              <summary>gelişmiş</summary>
              <div className="atki-gelismis-body">
                <label title="Örgü matrisinin satır sırasını çevir (rows[0] bandın son atkısı)">
                  <input
                    type="checkbox"
                    checked={atki.secenekler.satirTers}
                    onChange={(e) => openAtki({ ...atki, secenekler: { ...atki.secenekler, satirTers: e.target.checked } }, true)}
                  />
                  satirTers
                </label>
                <label title="0/1'i çevir ('1' = atkı üstte)">
                  <input
                    type="checkbox"
                    checked={atki.secenekler.matrisTers}
                    onChange={(e) => openAtki({ ...atki, secenekler: { ...atki.secenekler, matrisTers: e.target.checked } }, true)}
                  />
                  matrisTers
                </label>
                <label title="Bant içinde örgü satırı hangi atkı indeksine göre ilerlesin">
                  atkı modu
                  <select
                    value={atki.secenekler.atkiModu}
                    onChange={(e) => openAtki({ ...atki, secenekler: { ...atki.secenekler, atkiModu: e.target.value as AtkiSecenekler['atkiModu'] } }, true)}
                  >
                    <option value="bant">bant içi</option>
                    <option value="global">global</option>
                  </select>
                </label>
              </div>
            </details>
          )}
          <button onClick={() => download('kumas.json', new Blob([serializeFabricJson(spec)], { type: 'application/json' }))}>
            JSON dışa aktar
          </button>
          <span className="sep" />
          <select value={exportScale} onChange={(e) => setExportScale(+e.target.value)}>
            {[1, 2, 4].map((s) => (
              <option key={s} value={s}>
                {s}x
              </option>
            ))}
          </select>
          <button onClick={exportPng} disabled={exporting}>
            PNG dışa aktar
          </button>
        </div>
        {message && <div className="message">{message}</div>}
      </header>
      <aside className="sidebar">
        <YarnPanel spec={spec} onChange={setSpec} />
        <FabricPanel spec={spec} onChange={setSpec} />
      </aside>
      <section className="editor-col">
        {spec.threading && spec.liftplan ? (
          <WeaveEditor mode="armur" weave={spec.liftplan} onChange={(lp) => setSpec((s) => withThreading(s, s.threading!, lp, lp[0].length))} />
        ) : (
          <WeaveEditor weave={spec.weave} onChange={(weave) => setSpec((s) => ({ ...s, weave }))} />
        )}
        <ThreadingEditor spec={spec} onChange={setSpec} />
      </section>
      <main className="render-col">
        <div className="view-bar">
          <div className="seg">
            <button className={mode === 'single' ? 'on' : ''} onClick={() => setMode('single')}>
              Tek
            </button>
            <button className={mode === 'compare' ? 'on' : ''} onClick={() => setMode('compare')}>
              Tezgah | Mamul
            </button>
          </div>
          <div className="seg">
            {AREAS_MM.map((mm) => (
              <button key={mm} className={Math.abs(shownMm - mm) < 0.05 ? 'on' : ''} onClick={() => setArea(mm)}>
                {mm} mm
              </button>
            ))}
          </div>
          <button className={realSizeOn ? 'on' : ''} onClick={setRealSize} title="Gerçek boyut: ekranda 1 mm = kumaşta 1 mm (ekran kalibrasyonuyla)">
            Gerçek boyut
          </button>
          <details className="atki-gelismis" title="Ekran kalibrasyonu: çubuğu bir kredi kartının genişliğine eşitleyin">
              <summary>ekran</summary>
              <div className="atki-gelismis-body">
                <div style={{ width: CARD_WIDTH_MM * physPpm, height: 18, background: '#3fc0a0', borderRadius: 3 }} />
                <span className="muted">Çubuğu kredi kartı genişliğine ({CARD_WIDTH_MM} mm) eşitleyin</span>
                <input
                  type="range"
                  min={0.6}
                  max={1.6}
                  step={0.005}
                  value={screenCalib}
                  onChange={(e) => {
                    const v = +e.target.value;
                    setScreenCalib(v);
                    try {
                      localStorage.setItem(CALIB_KEY, String(v));
                    } catch {
                      /* depolama kapalıysa yalnız bu oturum */
                    }
                  }}
                />
                <span className="muted">{(96 * screenCalib).toFixed(0)} dpi (CSS)</span>
              </div>
            </details>

          <span className="muted">
            {shownMm.toFixed(1)} mm · {view.pxPerMm.toFixed(0)} px/mm
          </span>
          {mode === 'compare' && (
            <div className="seg">
              <button className={compareKind === 'sameYarns' ? 'on' : ''} onClick={() => setCompareKind('sameYarns')}>
                Aynı iplikler
              </button>
              <button
                className={compareKind === 'sameArea' ? 'on' : ''}
                onClick={() => setCompareKind('sameArea')}
                title="Aynı boyutta alan; üst kenar iki panelde aynı atkıdan başlar (çekmeye rağmen bant sınırları hizalı)"
              >
                Aynı alan
              </button>
              <button
                className={compareKind === 'physicalArea' ? 'on' : ''}
                onClick={() => setCompareKind('physicalArea')}
                title="Aynı mm koordinatı (hizalama yok; çekme yüzünden mamulde bant sınırları kayar)"
              >
                Fiziksel alan
              </button>
            </div>
          )}
          <label className="check">
            <input type="checkbox" checked={showStrips} onChange={(e) => setShowStrips(e.target.checked)} />
            Bağlantı şeritleri
          </label>
          {mode === 'compare' && (
            <label className="check">
              <input type="checkbox" checked={showWeftLinks} onChange={(e) => setShowWeftLinks(e.target.checked)} />
              Tezgah → mamul çizgileri (atkı)
            </label>
          )}
          {spec.reed && (
            <label className="check">
              <input type="checkbox" checked={showLinks} onChange={(e) => setShowLinks(e.target.checked)} />
              Tarak → mamul çizgileri
            </label>
          )}
          <label
            className="check"
            title={
              realUnavailable
                ? 'Gerçekçi görünüm kullanılamıyor (WebGL2 / kayan nokta hedefi yok ya da WebGL bağlamı kayboldu); mevcut görünüm kullanılıyor.'
                : `Yakında (≥ ${REALISTIC_FULL_PPM} px/mm) tüm panel, uzakta imleci izleyen ×${LOUPE_ZOOM} büyüteç`
            }
          >
            <input type="checkbox" checked={realOn} disabled={realUnavailable} onChange={(e) => setRealOn(e.target.checked)} />
            Gerçekçi
          </label>
          {realOn && (
            <select value={realQuality} onChange={(e) => setRealQuality(e.target.value as QualityPref)} title="Gerçekçi görünüm kalitesi">
              <option value="auto">Kalite: otomatik</option>
              <option value="high">Kalite: yüksek</option>
              <option value="medium">Kalite: orta</option>
              <option value="low">Kalite: düşük</option>
            </select>
          )}
          {realOn && (
            <select value={distance} onChange={(e) => setDistance(e.target.value as DistancePref)} title="Bakış mesafesi (zoom'dan ayrı)">
              <option value="eye">Bakış: Göz (40 cm)</option>
              <option value="far">Bakış: Uzak (2 m)</option>
              <option value="loupe">Bakış: Lup</option>
            </select>
          )}
          {realOn && (
            <select value={realBackground} onChange={(e) => setUserBackground(e.target.value as BackgroundPref)} title="Boşlukların zemini (açık: arkası aydınlık perde; arkadan ışık: ışık geçirgenliği). Elle seçilince mod değişince korunur.">
              <option value="light">Zemin: açık</option>
              <option value="darkgray">Zemin: koyu gri</option>
              <option value="black">Zemin: siyah</option>
              <option value="backlight">Zemin: arkadan ışık</option>
            </select>
          )}
          <label className="seed">
            seed
            <input type="number" value={seed} onChange={(e) => setSeed(Math.floor(+e.target.value) || 0)} />
          </label>
        </div>
        {metrics && structure && <MetricsBar metrics={metrics} structure={structure} renderOpenPct={info?.openPct ?? null} />}
        <div className="repeat-card" title="Desen ancak bu uzunlukta tam tekrar eder">
          <span>Rapor tekrarları:</span>
          {repeats.reedEnds > 0 && (
            <span>
              taraklama <b>{repeats.reedDents} diş / {repeats.reedEnds} tel</b>
            </span>
          )}
          <span>
            çözgü renk/iplik <b>{repeats.seq} tel</b>
          </span>
          <span>
            örgü <b>{repeats.weave} tel</b>
          </span>
          <span className="lcm">
            ortak (EKOK) <b>{repeats.all} tel</b> = {repeats.loomMm.toFixed(2)} mm tezgahta · {repeats.finMm.toFixed(2)} mm mamulde
          </span>
          <span className="sep-line" />
          <span>Atkı:</span>
          <span>
            örgü <b>{repeats.weaveF} atkı</b>
          </span>
          <span>
            atkı renk/iplik <b>{repeats.seqF} atkı</b>
          </span>
          {repeats.reportF > 0 && (
            <span>
              atkı sıklık raporu <b>{repeats.reportF} atkı</b>
            </span>
          )}
          <span className="lcm">
            ortak (EKOK) <b>{repeats.allF} atkı</b> = {repeats.loomMmF.toFixed(2)} mm tezgahta · {repeats.finMmF.toFixed(2)} mm mamulde
          </span>
          <span className="muted">— desen ancak bu uzunluklarda tam tekrar eder</span>
        </div>
        <div className={`panes ${mode}`}>
          {mode === 'compare' && (
            <FabricPane
              spec={loomSpec}
              seed={seed}
              view={view}
              title="Tezgah"
              strips={showStrips && positions ? { warp: positions.warp, weft: positions.weft, which: 'loom' } : undefined}
              reedStrip={loomStrip}
              onViewChange={setView}
              realistic={realistic}
            />
          )}
          <FabricPane
            spec={debSpec}
            seed={seed}
            view={view}
            title={mode === 'compare' ? (compareKind === 'sameYarns' ? 'Mamul (aynı iplikler)' : compareKind === 'sameArea' ? 'Mamul (üst kenar aynı atkı)' : 'Mamul') : undefined}
            renderWindow={finishedWindow}
            strips={showStrips && positions ? { warp: positions.warp, weft: positions.weft, which: 'finished' } : undefined}
            reedStrip={finishedStrip}
            weftLinks={mode === 'compare' ? weftLinks : undefined}
            shrinkLabel={shrinkLabel}
            onViewChange={setView}
            onInfo={setInfo}
            onSize={onSize}
            realistic={realistic}
          />
        </div>
      </main>
      {calibOpened && (
        <div className="calib-layer" hidden={page !== 'calib'}>
          <Suspense fallback={<div className="calib-msg">Kalibrasyon yükleniyor…</div>}>
            <CalibrationView spec={spec} seed={seed} />
          </Suspense>
        </div>
      )}
    </div>
  );
}
