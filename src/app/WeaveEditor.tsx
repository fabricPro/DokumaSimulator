import { useEffect, useRef } from 'react';
import { WEAVE_PRESETS } from '../presets/weaves';

interface Props {
  weave: boolean[][];
  onChange: (w: boolean[][]) => void;
  /** 'armur': tahar açıkken atkı × çerçeve (sütun = çerçeve). */
  mode?: 'weave' | 'armur';
  /** Atkı regülatörü raporu: satır hizalı küçük N / R sütunu (atkı r için rapor[r mod L]). */
  regulator?: Array<'N' | 'R'>;
}

const MAX_DIM = 200;

/** Örgü ızgarası. Görselde 0. atkı en altta; siyah = çözgü üstte. */
export function WeaveEditor({ weave, onChange, mode = 'weave', regulator }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rows = weave.length;
  const cols = weave[0].length;
  const cellPx = Math.max(3, Math.min(22, Math.floor(260 / Math.max(rows, cols))));
  const paintValue = useRef<boolean | null>(null);
  const lastCell = useRef<string>('');

  useEffect(() => {
    const c = canvasRef.current!;
    c.width = cols * cellPx + 1;
    c.height = rows * cellPx + 1;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#f3efe6';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#1d1f23';
    for (let r = 0; r < rows; r++) {
      const y = (rows - 1 - r) * cellPx;
      for (let col = 0; col < cols; col++) if (weave[r][col]) ctx.fillRect(col * cellPx, y, cellPx, cellPx);
    }
    if (cellPx >= 5) {
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= cols; x++) {
        ctx.moveTo(x * cellPx + 0.5, 0);
        ctx.lineTo(x * cellPx + 0.5, rows * cellPx);
      }
      for (let y = 0; y <= rows; y++) {
        ctx.moveTo(0, y * cellPx + 0.5);
        ctx.lineTo(cols * cellPx, y * cellPx + 0.5);
      }
      ctx.stroke();
    }
  }, [weave, rows, cols, cellPx]);

  const cellAt = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const col = Math.floor((e.clientX - rect.left) / cellPx);
    const vr = Math.floor((e.clientY - rect.top) / cellPx);
    const r = rows - 1 - vr;
    if (col < 0 || col >= cols || r < 0 || r >= rows) return null;
    return { r, col };
  };

  const apply = (r: number, col: number, value: boolean) => {
    if (weave[r][col] === value) return;
    onChange(weave.map((row, i) => (i === r ? row.map((v, j) => (j === col ? value : v)) : row)));
  };

  const onDown = (e: React.PointerEvent) => {
    const p = cellAt(e);
    if (!p) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    paintValue.current = !weave[p.r][p.col];
    lastCell.current = `${p.r},${p.col}`;
    apply(p.r, p.col, paintValue.current);
  };
  const onMove = (e: React.PointerEvent) => {
    if (paintValue.current === null) return;
    const p = cellAt(e);
    if (!p) return;
    const key = `${p.r},${p.col}`;
    if (key === lastCell.current) return;
    lastCell.current = key;
    apply(p.r, p.col, paintValue.current);
  };
  const onUp = () => {
    paintValue.current = null;
  };

  const resize = (newCols: number, newRows: number) => {
    newCols = Math.max(1, Math.min(MAX_DIM, Math.floor(newCols) || 1));
    newRows = Math.max(1, Math.min(MAX_DIM, Math.floor(newRows) || 1));
    const out: boolean[][] = [];
    for (let r = 0; r < newRows; r++) {
      const row: boolean[] = [];
      for (let c = 0; c < newCols; c++) row.push(weave[r % rows][c % cols]);
      out.push(row);
    }
    onChange(out);
  };

  return (
    <section className="panel">
      <h3>{mode === 'armur' ? 'Armür (atkı × çerçeve)' : 'Örgü'}</h3>
      <div className="row">
        <select
          value=""
          onChange={(e) => {
            const p = WEAVE_PRESETS.find((x) => x.id === e.target.value);
            if (p) onChange(p.weave.map((r) => [...r]));
          }}
        >
          <option value="">Hazır örgü…</option>
          {WEAVE_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="row">
        <label>
          {mode === 'armur' ? 'Çerçeve' : 'Genişlik'}
          <input type="number" min={1} max={MAX_DIM} value={cols} onChange={(e) => resize(+e.target.value, rows)} />
        </label>
        <label>
          Yükseklik
          <input type="number" min={1} max={MAX_DIM} value={rows} onChange={(e) => resize(cols, +e.target.value)} />
        </label>
        <button onClick={() => onChange(weave.map((r) => r.map((v) => !v)))} title="Tüm hücreleri ters çevir">
          Ters
        </button>
      </div>
      <div className="weave-grid weave-with-reg">
        {regulator && (
          <div className="reg-col" style={{ gridTemplateRows: `repeat(${rows}, ${cellPx}px)` }} title="Regülatör (DOB: R, PID: S) — atkı bir öncekinin hizasına atılır">
            {Array.from({ length: rows }, (_, k) => rows - 1 - k).map((r) => {
              const t = regulator[r % regulator.length];
              return (
                <span key={r} className={t === 'R' ? 'r' : ''} style={{ fontSize: Math.max(7, Math.min(11, cellPx - 2)) }}>
                  {t}
                </span>
              );
            })}
          </div>
        )}
        <canvas ref={canvasRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
      </div>
      <p className="hint">
        {mode === 'armur'
          ? 'Koyu = çerçeve kalkar (o çerçevedeki çözgüler üstte) · sütun = çerçeve F1… · 0. atkı en altta'
          : 'Koyu = çözgü üstte · 0. atkı en altta · tıkla/sürükle'}
      </p>
    </section>
  );
}
