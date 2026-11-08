import { useEffect, useState } from 'react';
import { deriveWeftReport, formatDenting, parseWeftReport, type FabricSpec } from '../render-engine';

/** Atkı sıklık raporu: atkı başına tezgah adım çarpanı ("1-1-1-3", "1x3, 2"). Boşsa eşit adım. */
export function WeftReportField({ spec, onChange }: { spec: FabricSpec; onChange: (s: FabricSpec) => void }) {
  const report = spec.weftDensityReport;
  const [text, setText] = useState(report ? formatDenting(report) : '');
  const [error, setError] = useState<string | null>(null);
  const key = report ? report.join(',') : '';
  useEffect(() => {
    const r = text.trim() === '' ? null : parseWeftReport(text);
    const current = r && r.ok ? r.report.join(',') : '';
    if (current !== key) {
      setText(report ? formatDenting(report) : '');
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const onText = (v: string) => {
    setText(v);
    if (v.trim() === '') {
      setError(null);
      const rest = { ...spec };
      delete rest.weftDensityReport;
      onChange(rest);
      return;
    }
    const r = parseWeftReport(v);
    if (r.ok) {
      setError(null);
      onChange({ ...spec, weftDensityReport: r.report });
    } else setError(r.error);
  };

  let derived: ReturnType<typeof deriveWeftReport> | null = null;
  try {
    derived = report ? deriveWeftReport(spec.weftDensityLoom, report) : null;
  } catch {
    derived = null;
  }
  return (
    <div className="weft-report">
      <label className="numfield">
        <span>Atkı sıklık raporu (adım çarpanı, boş = eşit)</span>
        <input
          className={'seq-text' + (error ? ' invalid' : '')}
          value={text}
          onChange={(e) => onText(e.target.value)}
          placeholder="ör. 1-1-1-3 veya 1x3, 2"
          spellCheck={false}
        />
      </label>
      {error && <div className="inline-error">{error}</div>}
      {derived && (
        <p className="hint">
          Ortalama tezgah atkı sıklığı <b>{derived.meanDensity.toFixed(2)} atkı/cm</b> · rapor {derived.picks} atkı,{' '}
          {derived.lengthMm.toFixed(2)} mm
        </p>
      )}
    </div>
  );
}
