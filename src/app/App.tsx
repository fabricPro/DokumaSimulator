import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_PARAMS,
  imageSize,
  scaleParams,
  weaveInputFromSpec,
  type FabricSpec,
} from '../render-engine';
import { parseWif } from '../importers/wif';
import { parseFabricJson, serializeFabricJson } from '../importers/fabricJson';
import { atkiJsonImporter } from '../importers/atkiJson';
import { dobbyFancy } from '../presets/weaves';
import { FabricControls, RenderControls, type RenderParams } from './Controls';
import { FabricView, type FabricViewHandle, type ViewState } from './FabricView';
import { RenderClient, imageToCanvas } from './renderClient';
import { WeaveEditor } from './WeaveEditor';

const T = '#3fc0d2';
const G = '#4a5058';

const INITIAL_SPEC: FabricSpec = {
  weave: dobbyFancy(),
  warpColors: [T, G, T, G, G, T, G, T],
  weftColors: [G, T, G, G, T, G, T, T, G],
  warpYarn: { count: 30, system: 'Ne' },
  weftYarn: { count: 30, system: 'Ne' },
  warpDensity: 30,
  weftDensity: 28,
  repeatX: 3,
  repeatY: 3,
};

const { cell: _cell, ...INITIAL_PARAMS } = DEFAULT_PARAMS;
void _cell;

/** PNG dışa aktarmada izin verilen en büyük piksel sayısı. */
const MAX_EXPORT_PIXELS = 64_000_000;

/** Değeri gecikmeli yansıtır (ağır yeniden render'ları seyreltmek için). */
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
  const [spec, setSpec] = useState<FabricSpec>(INITIAL_SPEC);
  const [params, setParams] = useState<RenderParams>(INITIAL_PARAMS);
  const [view, setView] = useState<ViewState>({ cell: 36, panX: 0, panY: 0 });
  const [message, setMessage] = useState('');
  const [exportScale, setExportScale] = useState(2);
  const [exporting, setExporting] = useState(false);
  const viewRef = useRef<FabricViewHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Örgü/renk değişikliklerinde yeniden çizim debounce'lu; kaydırıcılar önizleme ile anında
  const debSpec = useDebounced(spec, 60);
  const input = useMemo(() => weaveInputFromSpec(debSpec), [debSpec]);

  useEffect(() => {
    // İlk açılışta ekrana sığdır
    const t = setTimeout(() => viewRef.current?.fit(), 50);
    return () => clearTimeout(t);
  }, []);

  const onImport = async (file: File) => {
    try {
      const text = await file.text();
      const name = file.name.toLowerCase();
      if (atkiJsonImporter.accepts(name)) {
        setSpec((s) => ({ ...s, ...atkiJsonImporter.parse(text) }));
      } else if (name.endsWith('.wif')) {
        const r = parseWif(text);
        setSpec((s) => ({
          ...s,
          weave: r.weave,
          warpColors: r.warpColors ?? s.warpColors,
          weftColors: r.weftColors ?? s.weftColors,
          repeatX: Math.max(1, Math.round(28 / r.weave[0].length)),
          repeatY: Math.max(1, Math.round(28 / r.weave.length)),
        }));
        setMessage(
          `WIF yüklendi: ${r.weave[0].length}×${r.weave.length}` + (r.warnings.length ? ` · ${r.warnings.join(' ')}` : ''),
        );
      } else {
        setSpec(parseFabricJson(text));
        setMessage('FabricSpec JSON yüklendi.');
      }
      setTimeout(() => viewRef.current?.fit(), 100);
    } catch (e) {
      setMessage('İçe aktarma hatası: ' + (e as Error).message);
    }
  };

  const exportPng = useCallback(async () => {
    const p = scaleParams({ ...params, cell: view.cell }, exportScale);
    const inp = weaveInputFromSpec(spec);
    const { width, height } = imageSize(inp, p.cell);
    if (width * height > MAX_EXPORT_PIXELS) {
      setMessage(`Çok büyük: ${width}×${height} px. Zoom'u veya tekrar sayısını azaltın.`);
      return;
    }
    setExporting(true);
    setMessage(`PNG hazırlanıyor (${width}×${height} px)…`);
    const client = new RenderClient();
    try {
      const res = await client.request(inp, p);
      if (!res) throw new Error('render iptal edildi');
      const canvas = imageToCanvas(res.image);
      const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/png'));
      if (!blob) throw new Error('PNG kodlanamadı');
      download(`dokuma-${width}x${height}.png`, blob);
      setMessage(`PNG kaydedildi: ${width}×${height} px · ${Math.round(res.ms)} ms`);
    } catch (e) {
      setMessage('PNG hatası: ' + (e as Error).message);
    } finally {
      client.dispose();
      setExporting(false);
    }
  }, [params, view.cell, exportScale, spec]);

  const exportPreviewSize = imageSize(weaveInputFromSpec(spec), view.cell * exportScale);

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
          <button onClick={exportPng} disabled={exporting} title={`${exportPreviewSize.width}×${exportPreviewSize.height} px`}>
            PNG dışa aktar
          </button>
        </div>
        {message && <div className="message">{message}</div>}
      </header>
      <aside className="sidebar">
        <RenderControls params={params} onChange={setParams} />
        <FabricControls spec={spec} onChange={setSpec} />
      </aside>
      <section className="editor-col">
        <WeaveEditor weave={spec.weave} onChange={(weave) => setSpec((s) => ({ ...s, weave }))} />
      </section>
      <main className="render-col">
        <FabricView ref={viewRef} input={input} params={params} view={view} onViewChange={setView} />
      </main>
    </div>
  );
}
