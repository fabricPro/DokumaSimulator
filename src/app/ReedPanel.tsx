import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_WIRE_RATIO,
  REED_UNITS,
  deriveReed,
  formatDenting,
  parseDenting,
  type FabricSpec,
  type ReedSpec,
  type ReedUnit,
} from '../render-engine';

const TEMPLATES: Array<[string, number[]]> = [
  ["2'li düz", [2]],
  ['3-0 (yalancı lino)', [3, 0]],
  ['3-3-0', [3, 3, 0]],
  ['4-0-0', [4, 0, 0]],
  ['2-2-3-0', [2, 2, 3, 0]],
];

const LONG_PRESS_MS = 450;
const MAX_ENDS_PER_DENT = 12;

function NumberInput({
  value,
  onChange,
  step = 1,
  min = 0,
  width = 76,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  width?: number;
}) {
  return (
    <input
      type="number"
      step={step}
      min={min}
      value={value}
      style={{ width }}
      onChange={(e) => {
        const v = +e.target.value;
        if (Number.isFinite(v) && v >= min) onChange(v);
      }}
    />
  );
}

/** Tıklanabilir diş şeridi: tık +1, sağ tık veya uzun basma −1, 0 = boş diş. */
function DentStrip({ report, onChange }: { report: number[]; onChange: (r: number[]) => void }) {
  const timer = useRef<number | null>(null);
  const longPressed = useRef(false);
  const set = (i: number, d: number) => {
    const out = report.slice();
    out[i] = Math.max(0, Math.min(MAX_ENDS_PER_DENT, out[i] + d));
    if (out.some((n) => n > 0)) onChange(out);
  };
  return (
    <div className="dent-strip">
      {report.map((n, i) => (
        <button
          key={i}
          className={'dent-btn' + (n === 0 ? ' empty' : '')}
          title={`${i + 1}. diş: ${n} tel · tık +1, sağ tık / uzun bas −1`}
          onPointerDown={() => {
            longPressed.current = false;
            timer.current = window.setTimeout(() => {
              longPressed.current = true;
              set(i, -1);
            }, LONG_PRESS_MS);
          }}
          onPointerUp={() => {
            if (timer.current) window.clearTimeout(timer.current);
          }}
          onPointerLeave={() => {
            if (timer.current) window.clearTimeout(timer.current);
          }}
          onClick={() => {
            if (!longPressed.current) set(i, +1);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            set(i, -1);
          }}
        >
          <span className="dent-ends">
            {Array.from({ length: Math.min(n, 6) }, (_, k) => (
              <i key={k} />
            ))}
          </span>
          <b>{n}</b>
        </button>
      ))}
      <button className="dent-add" title="Rapora diş ekle" onClick={() => onChange([...report, report[report.length - 1] ?? 1])}>
        +
      </button>
      {report.length > 1 && (
        <button className="dent-add" title="Son dişi kaldır" onClick={() => report.slice(0, -1).some((n) => n > 0) && onChange(report.slice(0, -1))}>
          −
        </button>
      )}
    </div>
  );
}

export function ReedPanel({ spec, onChange }: { spec: FabricSpec; onChange: (s: FabricSpec) => void }) {
  const reed = spec.reed;
  const [text, setText] = useState<string>(reed ? formatDenting(reed.dentingReport) : '');
  const [error, setError] = useState<string | null>(null);
  const [adv, setAdv] = useState(false);
  const lastReport = useRef<string>('');

  // Şerit / şablon / içe aktarma değişince metni güncelle (metinden gelen değişikliği ezmeden)
  useEffect(() => {
    if (!reed) return;
    const key = reed.dentingReport.join(',');
    if (key !== lastReport.current) {
      lastReport.current = key;
      const parsed = parseDenting(text);
      if (!parsed.ok || parsed.report.join(',') !== key) setText(formatDenting(reed.dentingReport));
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reed?.dentingReport]);

  const setReed = (r: ReedSpec | undefined) => onChange({ ...spec, reed: r });
  const update = (patch: Partial<ReedSpec>) => reed && setReed({ ...reed, ...patch });
  const setReport = (report: number[]) => update({ dentingReport: report });

  const onText = (v: string) => {
    setText(v);
    const r = parseDenting(v);
    if (r.ok) {
      setError(null);
      lastReport.current = r.report.join(',');
      setReport(r.report);
    } else {
      setError(r.error);
    }
  };

  let derived: ReturnType<typeof deriveReed> | null = null;
  try {
    // Tarak açıkken sıklık taraktan gelir; elle girilen değer saklanır (karşılaştırma uyarısı yok)
    derived = reed ? deriveReed(reed) : null;
  } catch {
    derived = null;
  }

  return (
    <div className="reed">
      <label className="check">
        <input
          type="checkbox"
          checked={!!reed}
          onChange={(e) => {
            if (e.target.checked) {
              const r: ReedSpec = { reedNumber: spec.warpDensityLoom, reedUnit: 'diş/cm', dentingReport: [1] };
              setText('1');
              lastReport.current = '1';
              setReed(r);
            } else setReed(undefined);
          }}
        />
        Tarak
      </label>
      {reed && (
        <>
          <div className="row">
            <label className="numfield">
              <span>Tarak numarası</span>
              <span className="numfield-input">
                <NumberInput value={reed.reedNumber} step={0.5} min={0.1} onChange={(v) => v > 0 && update({ reedNumber: v })} />
                <select value={reed.reedUnit ?? 'diş/cm'} onChange={(e) => update({ reedUnit: e.target.value as ReedUnit })}>
                  {REED_UNITS.map((u) => (
                    <option key={u}>{u}</option>
                  ))}
                </select>
              </span>
            </label>
            <label className="numfield">
              <span>Tarak eni (cm, ops.)</span>
              <NumberInput
                value={reed.reedWidthCm ?? 0}
                step={1}
                min={0}
                onChange={(v) => update({ reedWidthCm: v > 0 ? v : undefined })}
              />
            </label>
          </div>
          <label className="numfield">
            <span>Taraklama raporu (diş başına tel)</span>
            <input
              className={'seq-text' + (error ? ' invalid' : '')}
              value={text}
              onChange={(e) => onText(e.target.value)}
              placeholder="ör. 3-0, 3x4, 0x2, (2-2-3)x2, 0"
              spellCheck={false}
            />
          </label>
          {error && <div className="inline-error">{error}</div>}
          <DentStrip report={reed.dentingReport} onChange={setReport} />
          <div className="templates">
            {TEMPLATES.map(([name, r]) => (
              <button key={name} onClick={() => setReport(r)}>
                {name}
              </button>
            ))}
          </div>
          <button className="link" onClick={() => setAdv(!adv)}>
            {adv ? '▴' : '▾'} Gelişmiş
          </button>
          {adv && (
            <div className="row">
              <label className="numfield">
                <span>Diş teli / adım</span>
                <NumberInput
                  value={reed.wireRatio ?? DEFAULT_WIRE_RATIO}
                  step={0.05}
                  min={0}
                  onChange={(v) => v < 0.95 && update({ wireRatio: v })}
                />
              </label>
              <label className="numfield">
                <span>Başlangıç dişi</span>
                <NumberInput value={reed.startOffset ?? 0} step={1} min={0} onChange={(v) => update({ startOffset: Math.floor(v) })} />
              </label>
            </div>
          )}
          {derived && (
            <div className="derived-card">
              <div>
                <span>Ortalama tel/diş</span>
                <b>{derived.avgEndsPerDent.toFixed(2)}</b>
              </div>
              <div>
                <span>Tezgah çözgü sıklığı</span>
                <b>{derived.loomWarpDensity.toFixed(2)} tel/cm</b>
              </div>
              <div>
                <span>Diş adımı / açıklık</span>
                <b>
                  {derived.pitchMm.toFixed(3)} / {derived.openingMm.toFixed(3)} mm
                </b>
              </div>
              <div>
                <span>Rapor</span>
                <b>
                  {derived.reportDents} diş · {derived.reportEnds} tel · {derived.reportWidthMm.toFixed(2)} mm
                </b>
              </div>
              {derived.totals && (
                <div>
                  <span>Tarak eninde</span>
                  <b>
                    {derived.totals.dents} diş · {derived.totals.ends} tel · {derived.totals.fullRepeats} tam rapor
                  </b>
                </div>
              )}
              {derived.warnings.map((w, i) => (
                <p key={i} className="warn-text">
                  {w}
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
