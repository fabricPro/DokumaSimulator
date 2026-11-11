import { useEffect, useRef, useState } from 'react';
import {
  buildFabricPositions,
  parseRegulator,
  regulatorEffectiveDensity,
  regulatorStats,
  type FabricSpec,
} from '../render-engine';

const MAX_L = 64;
export const REGULATOR_TOOLTIP = 'Regülatör (DOB: R, PID: S) — atkı bir öncekinin hizasına atılır';

const fmt = (r: Array<'N' | 'R'>) => r.join(' ');

/**
 * Atkı regülatörü raporu (tarak raporunun atkıdaki aynası): uzunluk girişi, her atkı için tıklanabilir N / R hücre,
 * metin alanı. Rapor varken "Tezgah atkı sıklığı" = MAKİNE sıklığıdır; etkin sıklık = makine × L / (L − R).
 */
export function RegulatorPanel({ spec, onChange }: { spec: FabricSpec; onChange: (s: FabricSpec) => void }) {
  const report = spec.weftRegulator;
  const [text, setText] = useState(report ? fmt(report) : '');
  const [error, setError] = useState<string | null>(null);
  const last = useRef(report ? report.join('') : '');

  useEffect(() => {
    const key = report ? report.join('') : '';
    if (key !== last.current) {
      last.current = key;
      setText(report ? fmt(report) : '');
      setError(null);
    }
  }, [report]);

  const setReport = (r: Array<'N' | 'R'> | undefined) => {
    last.current = r ? r.join('') : '';
    if (r) onChange({ ...spec, weftRegulator: r });
    else {
      const rest = { ...spec };
      delete rest.weftRegulator;
      onChange(rest);
    }
  };

  const onText = (v: string) => {
    setText(v);
    const r = parseRegulator(v);
    if (r.ok) {
      setError(null);
      setReport(r.report);
    } else setError(r.error);
  };

  const st = regulatorStats(report);
  let pitch: number | null = null;
  let warn: string | null = null;
  if (report) {
    if (!st.valid) warn = 'Hiç normal (N) atkı yok: regülatör geçersiz, yok sayılıyor.';
    else pitch = 10 / spec.weftDensityLoom;
  }
  const overfull = report && st.valid ? buildFabricPositions(spec).weftRegulator?.overfull.length ?? 0 : 0;

  return (
    <div className="regulator" title={REGULATOR_TOOLTIP}>
      <label className="check">
        <input
          type="checkbox"
          checked={!!report}
          onChange={(e) => {
            if (e.target.checked) {
              setText('N R');
              setReport(['N', 'R']);
            } else setReport(undefined);
          }}
        />
        Regülatör (atkı)
      </label>
      {report && (
        <>
          <div className="row">
            <label className="numfield">
              <span>Rapor uzunluğu (atkı)</span>
              <input
                type="number"
                min={1}
                max={MAX_L}
                value={report.length}
                onChange={(e) => {
                  const n = Math.max(1, Math.min(MAX_L, Math.floor(+e.target.value) || 1));
                  const r = Array.from({ length: n }, (_, i) => report[i] ?? 'N');
                  setText(fmt(r));
                  setError(null);
                  setReport(r);
                }}
              />
            </label>
          </div>
          <div className="reg-strip" title={REGULATOR_TOOLTIP}>
            {report.map((t, i) => (
              <button
                key={i}
                className={'reg-cell' + (t === 'R' ? ' r' : '')}
                title={`${i + 1}. atkı: ${t === 'R' ? 'regülatörlü (bir öncekinin hizasına)' : 'normal (yeni diş)'} — ${REGULATOR_TOOLTIP}`}
                onClick={() => {
                  const r = report.map((x, k) => (k === i ? (x === 'N' ? 'R' : 'N') : x)) as Array<'N' | 'R'>;
                  setText(fmt(r));
                  setError(null);
                  setReport(r);
                }}
              >
                <small>{i + 1}</small>
                <b>{t}</b>
              </button>
            ))}
          </div>
          <label className="numfield">
            <span>Regülatör raporu (N normal, R regülatörlü)</span>
            <input
              className={'seq-text' + (error ? ' invalid' : '')}
              value={text}
              onChange={(e) => onText(e.target.value)}
              placeholder="ör. N R R N R R"
              spellCheck={false}
            />
          </label>
          {error && <div className="inline-error">{error}</div>}
          {warn && <div className="inline-error">{warn}</div>}
          {pitch !== null && (
            <p className="hint">
              Atkı dişi aralığı {pitch.toFixed(2)} mm · rapor {st.L} atkı ({st.N} diş, {st.R} regülatörlü) · etkin{' '}
              <b>{regulatorEffectiveDensity(spec.weftDensityLoom, report).toFixed(2)} atkı/cm</b>
              {overfull > 0 && ' · Atkı sıkıştı: regülatör grubu aralığa sığmıyor'}
            </p>
          )}
        </>
      )}
    </div>
  );
}
