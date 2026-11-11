import { useEffect, useMemo, useRef, useState } from 'react';
import {
  SLOT_NAMES,
  THREADING_TEMPLATES,
  assignSlotsByFrames,
  lcm,
  minimalPeriod,
  slotsPerFrame,
  threadingTemplate,
  weaveToThreading,
  withThreading,
  withoutThreading,
  type FabricSpec,
} from '../render-engine';

const MAX_THREADS = 200;
const MAX_FRAMES = 32;
/** Tel bazlı slot şeridinde en fazla gösterilen tel. */
const MAX_STRIP = 96;

/**
 * Tahar (tel × çerçeve) ızgarası + "çerçeveye iplik ata" + ters görünüm + tel bazlı iplik şeridi.
 * Kapalıyken örgü matrisi düz tahar olarak yorumlanır; açılınca mevcut örgüden en az çerçeveli tahar + armür
 * çıkarılır (weaveToThreading) ve örgü tuvali armürü düzenler.
 */
export function ThreadingEditor({ spec, onChange }: { spec: FabricSpec; onChange: (s: FabricSpec) => void }) {
  const on = !!(spec.threading && spec.liftplan);
  const threading = spec.threading ?? [];
  const frames = spec.frames ?? (on ? spec.liftplan![0].length : 0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cell = Math.max(6, Math.min(18, Math.floor(300 / Math.max(threading.length || 1, frames || 1))));
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(0);
  const [slot, setSlot] = useState(0);
  const painting = useRef(false);
  const perFrame = useMemo(() => (on ? slotsPerFrame(threading, spec.warpSequence, frames) : []), [on, threading, spec.warpSequence, frames]);

  const setThreading = (th: number[], F = frames) => {
    const lp = spec.liftplan ?? [];
    onChange(withThreading(spec, th, lp.map((r) => Array.from({ length: Math.max(F, ...th.map((f) => f + 1)) }, (_, f) => !!r[f])), Math.max(F, ...th.map((f) => f + 1))));
  };

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !on) return;
    const T = threading.length;
    c.width = T * cell + 1;
    c.height = frames * cell + 1;
    const g = c.getContext('2d')!;
    g.fillStyle = '#1b1e23';
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = '#3a3f47';
    for (let i = 0; i <= T; i++) {
      g.beginPath();
      g.moveTo(i * cell + 0.5, 0);
      g.lineTo(i * cell + 0.5, c.height);
      g.stroke();
    }
    for (let f = 0; f <= frames; f++) {
      g.beginPath();
      g.moveTo(0, f * cell + 0.5);
      g.lineTo(c.width, f * cell + 0.5);
      g.stroke();
    }
    // F1 altta (örgü tuvaliyle aynı yönelim: indeks yukarı)
    g.fillStyle = '#e8e2d0';
    threading.forEach((f, i) => g.fillRect(i * cell + 2, (frames - 1 - f) * cell + 2, cell - 3, cell - 3));
  }, [on, threading, frames, cell]);

  const at = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - r.left) / cell);
    const f = frames - 1 - Math.floor((e.clientY - r.top) / cell);
    return i >= 0 && i < threading.length && f >= 0 && f < frames ? { i, f } : null;
  };
  const paint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = at(e);
    if (!p || threading[p.i] === p.f) return;
    const th = [...threading];
    th[p.i] = p.f;
    setThreading(th);
  };

  // Tel bazlı slot şeridi: lcm(tahar, dizi) tel; tıklayınca o telin slotu döner
  const L = on ? lcm(threading.length, Math.max(1, spec.warpSequence.length)) : 0;
  const strip = Array.from({ length: Math.min(L, MAX_STRIP) }, (_, i) => spec.warpSequence[i % spec.warpSequence.length] ?? 0);
  const cycleThread = (i: number) => {
    const full = Array.from({ length: L }, (_, k) => spec.warpSequence[k % spec.warpSequence.length] ?? 0);
    full[i] = (full[i] + 1) % spec.warpSlots.length;
    onChange({ ...spec, warpSequence: minimalPeriod(full) });
  };

  return (
    <section className="panel">
      <h3>Tahar</h3>
      <label className="check">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            if (e.target.checked) {
              const t = weaveToThreading(spec.weave);
              onChange(withThreading(spec, t.threading, t.liftplan, t.frames));
              setTo(Math.max(0, t.frames - 1));
            } else onChange(withoutThreading(spec));
          }}
        />
        Tahar + armür (kapalı: örgü = düz tahar)
      </label>
      {on && (
        <>
          <div className="row">
            <label>
              Tel
              <input
                type="number"
                min={1}
                max={MAX_THREADS}
                value={threading.length}
                onChange={(e) => {
                  const n = Math.max(1, Math.min(MAX_THREADS, Math.floor(+e.target.value)));
                  setThreading(Array.from({ length: n }, (_, i) => threading[i % threading.length] ?? 0));
                }}
              />
            </label>
            <label>
              Çerçeve
              <input
                type="number"
                min={1}
                max={MAX_FRAMES}
                value={frames}
                onChange={(e) => {
                  const F = Math.max(1, Math.min(MAX_FRAMES, Math.floor(+e.target.value)));
                  setThreading(threading.map((f) => Math.min(f, F - 1)), F);
                }}
              />
            </label>
          </div>
          <div className="templates">
            {THREADING_TEMPLATES.map(([k, name]) => (
              <button key={k} onClick={() => setThreading(threadingTemplate(k, frames))} title={`${name} tahar (${frames} çerçeve)`}>
                {name}
              </button>
            ))}
          </div>
          <div className="threading-wrap">
            <div className="frame-labels" style={{ gridTemplateRows: `repeat(${frames}, ${cell}px)` }}>
              {Array.from({ length: frames }, (_, k) => frames - 1 - k).map((f) => {
                const s = perFrame[f] ?? [];
                return (
                  <span key={f} className={'frame-label' + (s.length > 1 ? ' multi' : '')} title={s.length > 1 ? 'Bu çerçevede birden fazla iplik var (bilgi)' : undefined}>
                    F{f + 1} {s.length ? s.map((x) => SLOT_NAMES[x]).join('+') : '–'}
                  </span>
                );
              })}
            </div>
            <div className="weave-grid">
              <canvas
                ref={canvasRef}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  painting.current = true;
                  paint(e);
                }}
                onPointerMove={(e) => painting.current && paint(e)}
                onPointerUp={() => (painting.current = false)}
                onPointerCancel={() => (painting.current = false)}
              />
            </div>
          </div>
          <p className="hint">Sütun = tel, satır = çerçeve (F1 altta) · tıkla/sürükle: tele çerçeve ata</p>
          <div className="row assign">
            <span>Çerçeveye iplik ata:</span>
            <select value={from} onChange={(e) => setFrom(+e.target.value)}>
              {Array.from({ length: frames }, (_, f) => (
                <option key={f} value={f}>
                  F{f + 1}
                </option>
              ))}
            </select>
            –
            <select value={Math.min(to, frames - 1)} onChange={(e) => setTo(+e.target.value)}>
              {Array.from({ length: frames }, (_, f) => (
                <option key={f} value={f}>
                  F{f + 1}
                </option>
              ))}
            </select>
            =
            <select value={Math.min(slot, spec.warpSlots.length - 1)} onChange={(e) => setSlot(+e.target.value)}>
              {spec.warpSlots.map((_, k) => (
                <option key={k} value={k}>
                  {SLOT_NAMES[k]}
                </option>
              ))}
            </select>
            <button
              onClick={() =>
                onChange({
                  ...spec,
                  warpSequence: assignSlotsByFrames(threading, spec.warpSequence, [{ from, to: Math.min(to, frames - 1), slot: Math.min(slot, spec.warpSlots.length - 1) }]),
                })
              }
            >
              Ata
            </button>
          </div>
          <div className="chips thread-strip" title="Tel bazlı iplik: tıklayınca o telin slotu değişir">
            {strip.map((s, i) => (
              <button key={i} className="chip small" onClick={() => cycleThread(i)} title={`Tel ${i + 1} · F${threading[i % threading.length] + 1}`}>
                {SLOT_NAMES[s]}
              </button>
            ))}
            {L > MAX_STRIP && <span className="hint">… {L} tel</span>}
          </div>
          <p className="hint">
            Rapor: tahar {threading.length} · iplik dizisi {spec.warpSequence.length}
            {spec.reed ? ` · tarak ${spec.reed.dentingReport.reduce((a, b) => a + b, 0)} tel` : ''} → çözgü raporu{' '}
            {lcm(lcm(threading.length, Math.max(1, spec.warpSequence.length)), spec.reed ? Math.max(1, spec.reed.dentingReport.reduce((a, b) => a + b, 0)) : 1)} tel
          </p>
        </>
      )}
    </section>
  );
}
