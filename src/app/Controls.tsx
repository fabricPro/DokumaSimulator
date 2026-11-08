import type { ReactNode } from 'react';
import { yarnGeometry, type FabricSpec, type HeightfieldParams, type YarnSpec, type YarnSystem } from '../render-engine';

/* ------------------------------ Renk raporu ------------------------------ */

export function ColorRepeatEditor({
  title,
  colors,
  onChange,
}: {
  title: string;
  colors: string[];
  onChange: (c: string[]) => void;
}) {
  const set = (i: number, v: string) => onChange(colors.map((c, j) => (j === i ? v : c)));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= colors.length) return;
    const out = [...colors];
    [out[i], out[j]] = [out[j], out[i]];
    onChange(out);
  };
  return (
    <div className="color-repeat">
      <div className="color-repeat-head">
        <span>{title}</span>
        <span className="muted">{colors.length} renk</span>
      </div>
      <div className="swatches">
        {colors.map((c, i) => (
          <div className="swatch" key={i}>
            <input type="color" value={normalizeHex(c)} onChange={(e) => set(i, e.target.value)} />
            <div className="swatch-tools">
              <button onClick={() => move(i, -1)} title="Sola">‹</button>
              <button onClick={() => colors.length > 1 && onChange(colors.filter((_, j) => j !== i))} title="Sil">
                ×
              </button>
              <button onClick={() => move(i, 1)} title="Sağa">›</button>
            </div>
          </div>
        ))}
        <button className="add" onClick={() => onChange([...colors, colors[colors.length - 1] ?? '#888888'])}>
          +
        </button>
      </div>
    </div>
  );
}

function normalizeHex(c: string): string {
  const h = c.trim().replace(/^#/, '');
  if (/^[0-9a-f]{6}$/i.test(h)) return '#' + h.toLowerCase();
  if (/^[0-9a-f]{3}$/i.test(h)) return '#' + h.split('').map((x) => x + x).join('').toLowerCase();
  return '#888888';
}

/* ------------------------------ Kaydırıcı ------------------------------ */

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format = (v) => String(v),
}: {
  label: ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <label className="slider">
      <span className="slider-label">
        {label}
        <b>{format(value)}</b>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
    </label>
  );
}

/* ------------------------------ Render parametreleri ------------------------------ */

export type RenderParams = Omit<HeightfieldParams, 'cell'>;

export function RenderControls({ params, onChange }: { params: RenderParams; onChange: (p: RenderParams) => void }) {
  const set = <K extends keyof RenderParams>(k: K, v: RenderParams[K]) => onChange({ ...params, [k]: v });
  return (
    <section className="panel">
      <h3>Görünüm</h3>
      <Slider label="İplik kalınlığı" value={params.yarnRatio} min={0.3} max={1} step={0.01} onChange={(v) => set('yarnRatio', v)} format={(v) => v.toFixed(2)} />
      <Slider label="Büküm adımı" value={params.plyPitch} min={0.2} max={1.5} step={0.01} onChange={(v) => set('plyPitch', v)} format={(v) => v.toFixed(2)} />
      <Slider label="Büküm açısı" value={params.twistAngle} min={-1.5} max={1.5} step={0.01} onChange={(v) => set('twistAngle', v)} format={(v) => v.toFixed(2)} />
      <Slider label="Dalgalanma" value={params.wobble} min={0} max={5} step={0.1} onChange={(v) => set('wobble', v)} format={(v) => v.toFixed(1)} />
      <label className="slider">
        <span className="slider-label">Seed</span>
        <div className="row">
          <input type="number" value={params.seed} onChange={(e) => set('seed', Math.floor(+e.target.value) || 0)} />
          <button onClick={() => set('seed', Math.floor(Math.random() * 100000))}>Rastgele</button>
        </div>
      </label>
    </section>
  );
}

/* ------------------------------ İplik / sıklık ------------------------------ */

const SYSTEMS: YarnSystem[] = ['Ne', 'Nm', 'Dtex', 'Denier'];

function YarnRow({ label, yarn, onChange }: { label: string; yarn: YarnSpec; onChange: (y: YarnSpec) => void }) {
  return (
    <div className="yarn-row">
      <span>{label}</span>
      <input type="number" min={0.1} step={0.1} value={yarn.count} onChange={(e) => +e.target.value > 0 && onChange({ ...yarn, count: +e.target.value })} />
      <select value={yarn.system} onChange={(e) => onChange({ ...yarn, system: e.target.value as YarnSystem })}>
        {SYSTEMS.map((s) => (
          <option key={s}>{s}</option>
        ))}
      </select>
      <input
        type="number"
        min={0.5}
        step={0.01}
        title="Lif yoğunluğu ρ (g/cm³)"
        value={yarn.fiberDensity ?? 1.38}
        onChange={(e) => +e.target.value > 0 && onChange({ ...yarn, fiberDensity: +e.target.value })}
      />
    </div>
  );
}

export function FabricControls({ spec, onChange }: { spec: FabricSpec; onChange: (s: FabricSpec) => void }) {
  const set = <K extends keyof FabricSpec>(k: K, v: FabricSpec[K]) => onChange({ ...spec, [k]: v });
  let ratioHint = '';
  try {
    const w = yarnGeometry(spec.warpYarn, spec.warpDensity);
    const f = yarnGeometry(spec.weftYarn, spec.weftDensity);
    ratioHint = `Hesaplanan çap/aralık — çözgü ${w.compression.toFixed(2)}, atkı ${f.compression.toFixed(2)} (çap ${w.diameter.toFixed(3)} / ${f.diameter.toFixed(3)} mm)`;
  } catch {
    ratioHint = '';
  }
  return (
    <section className="panel">
      <h3>İplik ve rapor</h3>
      <div className="yarn-head">
        <span />
        <span>Numara</span>
        <span>Sistem</span>
        <span>ρ</span>
      </div>
      <YarnRow label="Çözgü" yarn={spec.warpYarn} onChange={(y) => set('warpYarn', y)} />
      <YarnRow label="Atkı" yarn={spec.weftYarn} onChange={(y) => set('weftYarn', y)} />
      <Slider label="Çözgü sıklığı (tel/cm)" value={spec.warpDensity} min={5} max={80} step={1} onChange={(v) => set('warpDensity', v)} />
      <Slider label="Atkı sıklığı (tel/cm)" value={spec.weftDensity} min={5} max={80} step={1} onChange={(v) => set('weftDensity', v)} />
      {ratioHint && <p className="hint">{ratioHint}. İplik kalınlığı kaydırıcısı şimdilik bundan bağımsız.</p>}
      <Slider label="Rapor tekrarı X" value={spec.repeatX} min={1} max={20} step={1} onChange={(v) => set('repeatX', v)} />
      <Slider label="Rapor tekrarı Y" value={spec.repeatY} min={1} max={20} step={1} onChange={(v) => set('repeatY', v)} />
      <ColorRepeatEditor title="Çözgü renk raporu" colors={spec.warpColors} onChange={(c) => set('warpColors', c)} />
      <ColorRepeatEditor title="Atkı renk raporu (alttan)" colors={spec.weftColors} onChange={(c) => set('weftColors', c)} />
    </section>
  );
}
