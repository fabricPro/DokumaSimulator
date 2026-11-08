import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildFabricPositions,
  computeMetrics,
  mapLoomToFinished,
  lcm,
  slotOf,
  structureMetrics,
  type FabricSpec,
} from '../render-engine';
import type { PhysicalInfo } from '../render-engine/worker';
import { parseWif } from '../importers/wif';
import { parseFabricJson, serializeFabricJson } from '../importers/fabricJson';
import { atkiJsonImporter } from '../importers/atkiJson';
import { colorsToSlots } from '../importers/slots';
import { physicalExample } from '../presets/physicalExample';
import { FabricPanel, YarnPanel } from './Controls';
import { FabricPane, MAX_PPM, MIN_PPM, type MmView, type MmWindow, type ReedStripInfo } from './FabricPane';
import { MetricsBar } from './MetricsBar';
import { RenderClient, imageToCanvas } from './renderClient';
import { WeaveEditor } from './WeaveEditor';

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
  const [compareKind, setCompareKind] = useState<'sameYarns' | 'sameArea'>('sameYarns');
  const [showStrips, setShowStrips] = useState(false);
  const [showLinks, setShowLinks] = useState(true);
  const [view, setView] = useState<MmView>({ x0Mm: 0, y0Mm: 0, pxPerMm: 60 });
  const [paneSize, setPaneSize] = useState({ w: 0, h: 0 });
  const [info, setInfo] = useState<PhysicalInfo | null>(null);
  const [message, setMessage] = useState('');
  const [exportScale, setExportScale] = useState(2);
  const [exporting, setExporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const fitted = useRef(false);

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
  // İlk ölçümde 10 mm göster
  useEffect(() => {
    if (fitted.current || paneSize.w < 100) return;
    fitted.current = true;
    setArea(10);
  }, [paneSize.w, setArea]);
  const shownMm = (paneSize.w || 600) / view.pxPerMm;

  // "Aynı iplikler": tezgah penceresindeki ipliklerin mamuldeki (daralmış) penceresi
  const finishedWindow = useMemo<MmWindow | undefined>(() => {
    if (mode !== 'compare' || compareKind !== 'sameYarns' || !positions || paneSize.w === 0) return undefined;
    const x1 = view.x0Mm + paneSize.w / view.pxPerMm;
    const y1 = view.y0Mm + paneSize.h / view.pxPerMm;
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
    return { weave, seq, reedEnds, reedDents, all, loomMm: all * loomPitch, finMm: all * finPitch };
  }, [spec, positions]);

  const onImport = async (file: File) => {
    try {
      const text = await file.text();
      const name = file.name.toLowerCase();
      if (atkiJsonImporter.accepts(name)) {
        setSpec((s) => ({ ...s, ...atkiJsonImporter.parse(text) }));
      } else if (name.endsWith('.wif')) {
        const r = parseWif(text);
        const warnings = [...r.warnings];
        const next: FabricSpec = { ...spec, weave: r.weave };
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
        <WeaveEditor weave={spec.weave} onChange={(weave) => setSpec((s) => ({ ...s, weave }))} />
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
          <span className="muted">
            {shownMm.toFixed(1)} mm · {view.pxPerMm.toFixed(0)} px/mm
          </span>
          {mode === 'compare' && (
            <div className="seg">
              <button className={compareKind === 'sameYarns' ? 'on' : ''} onClick={() => setCompareKind('sameYarns')}>
                Aynı iplikler
              </button>
              <button className={compareKind === 'sameArea' ? 'on' : ''} onClick={() => setCompareKind('sameArea')}>
                Aynı alan
              </button>
            </div>
          )}
          <label className="check">
            <input type="checkbox" checked={showStrips} onChange={(e) => setShowStrips(e.target.checked)} />
            Bağlantı şeritleri
          </label>
          {spec.reed && (
            <label className="check">
              <input type="checkbox" checked={showLinks} onChange={(e) => setShowLinks(e.target.checked)} />
              Tarak → mamul çizgileri
            </label>
          )}
          <label className="seed">
            seed
            <input type="number" value={seed} onChange={(e) => setSeed(Math.floor(+e.target.value) || 0)} />
          </label>
        </div>
        {metrics && structure && <MetricsBar metrics={metrics} structure={structure} openPct={info?.openPct ?? null} />}
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
            ortak (EKOK) <b>{repeats.all} tel</b> = {repeats.loomMm.toFixed(2)} mm tezgahta · {repeats.finMm.toFixed(2)} mm mamulde — desen ancak bu uzunlukta tam tekrar eder
          </span>
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
            />
          )}
          <FabricPane
            spec={debSpec}
            seed={seed}
            view={view}
            title={mode === 'compare' ? (compareKind === 'sameYarns' ? 'Mamul (aynı iplikler)' : 'Mamul') : undefined}
            renderWindow={finishedWindow}
            strips={showStrips && positions ? { warp: positions.warp, weft: positions.weft, which: 'finished' } : undefined}
            reedStrip={finishedStrip}
            onViewChange={setView}
            onInfo={setInfo}
            onSize={onSize}
          />
        </div>
      </main>
    </div>
  );
}
