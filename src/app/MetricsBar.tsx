import type { FabricMetrics, SqueezeCheck, WarningLevel } from '../render-engine';

function Badge({ level, children }: { level: WarningLevel | 'error'; children: React.ReactNode }) {
  return <span className={`badge badge-${level}`}>{children}</span>;
}

export function MetricsBar({
  metrics,
  squeeze,
  openPct,
}: {
  metrics: FabricMetrics;
  squeeze: SqueezeCheck;
  openPct: number | null;
}) {
  const m = metrics;
  const jamText = (_pct: number, level: WarningLevel) =>
    level === 'ok' ? null : level === 'warn' ? 'teorik sınırın üstünde' : 'teorik sınırın çok üstünde';
  return (
    <div className="metrics">
      <div className="metric">
        <span>Mamul sıklık</span>
        <b>
          {m.Dw.toFixed(1)} <small>tel/cm</small> · {m.Df.toFixed(1)} <small>atkı/cm</small>
        </b>
      </div>
      <div className="metric">
        <span>Açıklık</span>
        <b>{openPct === null ? '…' : `%${openPct.toFixed(1)}`}</b>
      </div>
      <div className="metric">
        <span>Örtme</span>
        <b>%{m.cover.toFixed(0)}</b>
      </div>
      <div className="metric">
        <span>Gramaj</span>
        <b>~{m.gsm.toFixed(0)} g/m²</b>
      </div>
      <div className="metric">
        <span>Kıvrım ç / a</span>
        <b>
          %{m.crimpWarp.toFixed(1)} / %{m.crimpWeft.toFixed(1)}
        </b>
      </div>
      <div className="metric">
        <span>Sıkışma ç / a (Ashenhurst)</span>
        <b>
          <Badge level={m.jamLevelWarp}>%{m.jamWarp.toFixed(0)}</Badge> / <Badge level={m.jamLevelWeft}>%{m.jamWeft.toFixed(0)}</Badge>
        </b>
      </div>
      <div className="metric-warnings">
        {squeeze.jammedWarp && (
          <Badge level="error">Çözgü sıkıştı: iplikler sığmıyor (s={squeeze.minScaleWarp.toFixed(2)} &lt; 0.55)</Badge>
        )}
        {squeeze.jammedWeft && (
          <Badge level="error">Atkı sıkıştı: iplikler sığmıyor (s={squeeze.minScaleWeft.toFixed(2)} &lt; 0.55)</Badge>
        )}
        {jamText(m.jamWarp, m.jamLevelWarp) && <Badge level={m.jamLevelWarp}>Çözgü {jamText(m.jamWarp, m.jamLevelWarp)}</Badge>}
        {jamText(m.jamWeft, m.jamLevelWeft) && <Badge level={m.jamLevelWeft}>Atkı {jamText(m.jamWeft, m.jamLevelWeft)}</Badge>}
      </div>
    </div>
  );
}
