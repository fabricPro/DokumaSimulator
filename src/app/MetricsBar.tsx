import type { FabricMetrics, StructureMetrics, WarningLevel } from '../render-engine';

function Badge({ level, children }: { level: WarningLevel | 'error'; children: React.ReactNode }) {
  return <span className={`badge badge-${level}`}>{children}</span>;
}

const mm = (v: number) => (v < 0.995 ? v.toFixed(2) : v.toFixed(1));

export function MetricsBar({
  metrics,
  structure,
  openPct,
}: {
  metrics: FabricMetrics;
  structure: StructureMetrics;
  openPct: number | null;
}) {
  const m = metrics;
  const s = structure;
  const jamText = (level: WarningLevel) =>
    level === 'ok' ? null : level === 'warn' ? 'Ashenhurst teorik sınırının üstünde' : 'Ashenhurst sınırının çok üstünde';
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
        <span>En büyük gözenek</span>
        <b>
          {mm(s.poreMm[0])} × {mm(s.poreMm[1])} <small>mm</small>
        </b>
      </div>
      <div className="metric">
        <span>Grup genişliği ç / a</span>
        <b>
          {mm(s.warp.meanGroupWidthMm)} / {mm(s.weft.meanGroupWidthMm)} <small>mm</small>
        </b>
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
          <Badge level={m.jamLevelWarp}>%{m.jamWarp.toFixed(0)}</Badge> /{' '}
          <Badge level={m.jamLevelWeft}>%{m.jamWeft.toFixed(0)}</Badge>
        </b>
      </div>
      <div className="metric-warnings">
        {s.jammedWarp && <Badge level="error">Çözgü sıkıştı: tezgahta iplikler sığmıyor (tarak)</Badge>}
        {s.jammedWeft && <Badge level="error">Atkı sıkıştı: tezgahta iplikler sığmıyor</Badge>}
        {s.warnings.map((w, i) => (
          <Badge key={i} level={/mümkün değil/.test(w) ? 'error' : 'warn'}>
            {w}
          </Badge>
        ))}
        {jamText(m.jamLevelWarp) && <Badge level={m.jamLevelWarp}>Çözgü {jamText(m.jamLevelWarp)}</Badge>}
        {jamText(m.jamLevelWeft) && <Badge level={m.jamLevelWeft}>Atkı {jamText(m.jamLevelWeft)}</Badge>}
      </div>
    </div>
  );
}
