import type { PositionGenerator, ReedPositionGenerator } from '../render-engine';

/** Tarak şeridi: kumaşla aynı px/mm ve x eşlemesiyle panelin üst bandında çizilir. */
export interface ReedStripInfo {
  reed: ReedPositionGenerator;
  /** Çözgü g'nin rengi. */
  colorOf: (g: number) => string;
  /** Mamul konumları: verilirse tezgah → mamul bağlantı çizgileri çizilir. */
  finished?: PositionGenerator;
  /** Tezgah koordinatının ekrandaki başlangıcı (mm). Verilmezse panelin kumaş başlangıcı. */
  loomOriginX?: number;
}

/** Çizim bağlamı: tarayıcı CanvasRenderingContext2D ve @napi-rs/canvas ikisi de uyar. */
export interface StripContext {
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  font: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  save(): void;
  restore(): void;
  beginPath(): void;
  rect(x: number, y: number, w: number, h: number): void;
  clip(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  arc(x: number, y: number, r: number, a0: number, a1: number): void;
  fill(): void;
  measureText(text: string): { width: number };
  fillText(text: string, x: number, y: number): void;
}

export const DENT_BAND = 28;
export const LINK_BAND = 26;

/**
 * Tarak şeridi: diş telleri koyu çubuk, açıklıktaki teller çözgü renginde nokta, boş dişler taralı.
 * loomX0: tezgah koordinatının ekrandaki başlangıcı; fabX0: kumaşın (mamul) ekrandaki başlangıcı.
 */
export function drawReedStrip(
  ctx: StripContext,
  rs: ReedStripInfo,
  w: number,
  ppm: number,
  loomX0: number,
  fabX0: number,
) {
  const reed = rs.reed;
  const lx = (X: number) => (X - loomX0) * ppm;
  const fx = (X: number) => (X - fabX0) * ppm;
  const H = DENT_BAND;
  ctx.fillStyle = '#d6dade';
  ctx.fillRect(0, 0, w, H);
  const x1 = loomX0 + w / ppm;
  const dr = reed.dentRange(loomX0, x1);
  for (let j = dr.first - 1; j <= dr.last + 1; j++) {
    const d = reed.dentAt(j);
    // diş telleri (her diş sınırında, iki yarım tel)
    ctx.fillStyle = '#23272d';
    ctx.fillRect(lx(d.left), 2, lx(d.openLeft) - lx(d.left), H - 4);
    ctx.fillRect(lx(d.openRight), 2, lx(d.right) - lx(d.openRight), H - 4);
    if (d.ends === 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(lx(d.openLeft), 2, lx(d.openRight) - lx(d.openLeft), H - 4);
      ctx.clip();
      ctx.strokeStyle = 'rgba(60,66,74,0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let t = lx(d.openLeft) - H; t < lx(d.openRight); t += 5) {
        ctx.moveTo(t, H - 2);
        ctx.lineTo(t + H, 2);
      }
      ctx.stroke();
      ctx.restore();
    }
  }
  // Teller: tezgah konumlarında
  const r = reed.indexRange(loomX0, x1);
  const loomC = reed.centers(r.first, r.count);
  const finC = rs.finished ? rs.finished.centers(r.first, r.count) : null;
  for (let k = 0; k < r.count; k++) {
    const g = r.first + k;
    const x = lx(loomC[k]);
    ctx.fillStyle = rs.colorOf(g);
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, H / 2, Math.max(2, Math.min(5, ppm * 0.08)), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (finC) {
      ctx.strokeStyle = 'rgba(230,230,230,0.55)';
      ctx.beginPath();
      ctx.moveTo(x, H);
      ctx.lineTo(fx(finC[k]), H + LINK_BAND);
      ctx.stroke();
    }
  }
  // Diş adımı etiketi
  const label = `diş adımı ${reed.pitchMm.toFixed(2)} mm`;
  ctx.font = '12px system-ui, sans-serif';
  const tw = ctx.measureText(label).width;
  ctx.fillStyle = 'rgba(214,218,222,0.92)';
  ctx.fillRect(w - tw - 14, H - 15, tw + 10, 14);
  ctx.fillStyle = '#23272d';
  ctx.fillText(label, w - tw - 9, H - 4);
}
