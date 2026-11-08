/**
 * Kalibrasyon: calibration/samples/*.json kayıtlarını simülasyonla karşılaştırır ve
 *   yarnDensity (yoğunluğu verilmemiş slotlar için), warpCrimpShare, ρ (sertlik oranı) ve
 *   c (racetrack katsayısı) için ızgara araması yapar.
 *
 *   npm run calibrate                 → calibration/samples
 *   npm run calibrate -- <klasör>     → başka klasör
 *
 * Simülasyon girdisi olarak ölçülen çekmeler kullanılır. Hedef: gramaj, mamul sıklıklar ve açıklık %
 * göreli sapma karelerinin toplamı (ölçülmeyen alanlar atlanır). Izgarada açıklık % konumlardan analitik
 * izdüşümle hesaplanır (render pahalı); en iyi aday için render'lı açıklık ayrıca raporlanır.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildFabricPositions,
  computeMetrics,
  normalizeReedSpec,
  normalizeSystem,
  simulatePhysical,
  SLOT_NAMES,
  structureMetrics,
  type FabricSpec,
  type YarnSlot,
} from '../src/render-engine';
import { WEAVE_PRESETS } from '../src/presets/weaves';

interface CalibrationRecord {
  name: string;
  example?: boolean;
  weave?: boolean[][];
  weavePreset?: string;
  warpSlots: Array<Partial<YarnSlot> & { count: number; system: string }>;
  weftSlots: Array<Partial<YarnSlot> & { count: number; system: string }>;
  warpSequence: Array<number | string>;
  weftSequence: Array<number | string>;
  warpDensityLoom: number;
  weftDensityLoom: number;
  warpCrimpShare?: number;
  /** Yeni (reedNumber, dentingReport) veya eski (densityPerCm, denting) biçim. */
  reed?: unknown;
  relax?: { c?: number; rho?: number };
  photo?: { path: string; pxPerMm: number };
  measured: {
    warpDensity?: number;
    weftDensity?: number;
    warpShrinkPct?: number;
    weftShrinkPct?: number;
    gsm?: number;
    openPct?: number;
    groupWidthMm?: number;
    poreSizeMm?: [number, number];
  };
}

function toSpec(r: CalibrationRecord): FabricSpec {
  const weave = r.weave ?? WEAVE_PRESETS.find((p) => p.id === r.weavePreset)?.weave;
  if (!weave) throw new Error(`${r.name}: weave veya geçerli weavePreset gerekli`);
  const slots = (list: CalibrationRecord['warpSlots']): YarnSlot[] =>
    list.map((s, i) => ({
      name: SLOT_NAMES[i],
      count: s.count,
      system: normalizeSystem(s.system),
      color: s.color ?? '#888888',
      ...(s.yarnDensity ? { yarnDensity: s.yarnDensity } : {}),
      twist: s.twist === 'Z' ? 'Z' : 'S',
    }));
  const seq = (list: Array<number | string>) =>
    list.map((x) => (typeof x === 'number' ? x : SLOT_NAMES.indexOf(x.toUpperCase() as any)));
  return {
    version: 2,
    weave,
    warpSlots: slots(r.warpSlots),
    weftSlots: slots(r.weftSlots),
    warpSequence: seq(r.warpSequence),
    weftSequence: seq(r.weftSequence),
    warpDensityLoom: r.warpDensityLoom,
    weftDensityLoom: r.weftDensityLoom,
    warpShrinkPct: r.measured.warpShrinkPct ?? 0,
    weftShrinkPct: r.measured.weftShrinkPct ?? 0,
    warpCrimpShare: r.warpCrimpShare ?? 0.4,
    ...(normalizeReedSpec(r.reed) ? { reed: normalizeReedSpec(r.reed) } : {}),
    ...(r.relax ? { relax: r.relax } : {}),
  };
}

interface Params {
  rho: number; // yarnDensity (yoğunluğu verilmemiş slotlar)
  beta: number; // warpCrimpShare
  k: number; // ρ sertlik oranı
  c: number; // racetrack katsayısı
}

/** Parametreleri spec'e uygular (yoğunluğu verilmiş slotlar korunur). */
function withParams(s: FabricSpec, p: Params): FabricSpec {
  const fill = (list: YarnSlot[]) => list.map((y) => (y.yarnDensity ? y : { ...y, yarnDensity: p.rho }));
  return { ...s, warpSlots: fill(s.warpSlots), weftSlots: fill(s.weftSlots), warpCrimpShare: p.beta, relax: { c: p.c, rho: p.k } };
}

interface Sim {
  Dw: number;
  Df: number;
  gsm: number;
  openAnalytic: number;
  groupW: number;
  pore: [number, number];
}

function simulate(s: FabricSpec): Sim {
  const m = computeMetrics(s);
  const pos = buildFabricPositions(s);
  const st = structureMetrics(s, pos);
  return { Dw: m.Dw, Df: m.Df, gsm: m.gsm, openAnalytic: st.openPctAnalytic, groupW: st.warp.meanGroupWidthMm, pore: st.poreMm };
}

const dir = process.argv[2] ?? join('calibration', 'samples');
const records: CalibrationRecord[] = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf-8')));
if (records.length === 0) {
  console.log(`${dir} içinde kayıt yok.`);
  process.exit(0);
}
const specs = records.map(toSpec);

const rel = (sim: number, meas?: number) => (meas ? (sim - meas) / meas : NaN);
const f1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '—');
const f2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : '—');
const fp = (v: number) => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%' : '—');

function objective(p: Params): number {
  let err = 0;
  records.forEach((r, i) => {
    const sim = simulate(withParams(specs[i], p));
    const ms = r.measured;
    for (const [s, m] of [
      [sim.gsm, ms.gsm],
      [sim.Dw, ms.warpDensity],
      [sim.Df, ms.weftDensity],
      [sim.openAnalytic, ms.openPct],
    ] as Array<[number, number | undefined]>) {
      if (m) err += rel(s, m) ** 2;
    }
  });
  return err;
}

function table(title: string, p: Params, rendered = false) {
  console.log(`\n${title}`);
  const rows = records.map((r, i) => {
    const s = withParams(specs[i], p);
    const sim = simulate(s);
    const ms = r.measured;
    let openRendered = NaN;
    if (rendered) {
      const res = simulatePhysical(s, { x0Mm: 0, y0Mm: 0, widthMm: 8, heightMm: 8, pxPerMm: 50 }, { seed: 3, scaleBar: false });
      openRendered = res.openPct;
    }
    return {
      numune: (r.example ? '[ÖRNEK] ' : '') + r.name,
      'çözgü sim/ölç': `${f1(sim.Dw)} / ${f1(ms.warpDensity ?? NaN)} (${fp(rel(sim.Dw, ms.warpDensity))})`,
      'atkı sim/ölç': `${f1(sim.Df)} / ${f1(ms.weftDensity ?? NaN)} (${fp(rel(sim.Df, ms.weftDensity))})`,
      'g/m² sim/ölç': `${f1(sim.gsm)} / ${f1(ms.gsm ?? NaN)} (${fp(rel(sim.gsm, ms.gsm))})`,
      'açıklık% sim/ölç': `${f1(sim.openAnalytic)}${rendered ? ` [render ${f1(openRendered)}]` : ''} / ${f1(ms.openPct ?? NaN)}`,
      'grup mm sim/ölç': `${f2(sim.groupW)} / ${f2(ms.groupWidthMm ?? NaN)}`,
      'gözenek mm sim/ölç': `${f2(sim.pore[0])}×${f2(sim.pore[1])} / ${ms.poreSizeMm ? `${f2(ms.poreSizeMm[0])}×${f2(ms.poreSizeMm[1])}` : '—'}`,
    };
  });
  console.table(rows);
}

const DEFAULT: Params = { rho: 0.85, beta: 0.4, k: 8, c: 0.85 };
table('Varsayılan parametrelerle (yarnDensity 0.85, kıvrım payı 0.40, ρ 8, c 0.85):', DEFAULT);

// --- ızgara araması (4 boyut) ---
const grid: Array<Params & { err: number }> = [];
let best: Params & { err: number } = { ...DEFAULT, err: Infinity };
const t0 = Date.now();
for (let rho = 0.6; rho <= 1.1 + 1e-9; rho += 0.05) {
  for (let beta = 0.2; beta <= 0.6 + 1e-9; beta += 0.05) {
    for (const k of [1, 2, 4, 8, 16, 32]) {
      for (let c = 0.7; c <= 1.0 + 1e-9; c += 0.05) {
        const p = { rho, beta, k, c };
        const err = objective(p);
        grid.push({ ...p, err });
        if (err < best.err) best = { ...p, err };
      }
    }
  }
}
const nTerms = records.reduce(
  (n, r) => n + [r.measured.gsm, r.measured.warpDensity, r.measured.weftDensity, r.measured.openPct].filter(Boolean).length,
  0,
);
const rms = (e: number) => Math.sqrt(e / Math.max(1, nTerms)) * 100;
const near = grid.filter((g) => rms(g.err) <= rms(best.err) + 0.25);
const range = (key: keyof Params) => {
  const v = near.map((n) => n[key]);
  return `${Math.min(...v).toFixed(2)}–${Math.max(...v).toFixed(2)}`;
};

console.log(
  `\nIzgara araması (${grid.length} nokta, ${((Date.now() - t0) / 1000).toFixed(1)} s): yarnDensity 0.60–1.10 × kıvrım payı 0.20–0.60 × ρ {1..32} × c 0.70–1.00`,
);
console.log('  Hedef: gramaj + mamul sıklıklar + açıklık % göreli sapma karelerinin toplamı');
console.log(
  `  Öneri: yarnDensity = ${best.rho.toFixed(2)}, warpCrimpShare = ${best.beta.toFixed(2)}, ρ = ${best.k}, c = ${best.c.toFixed(2)}  (RMS sapma %${rms(best.err).toFixed(2)})`,
);
console.log(
  `  En iyiye %0.25 yakın bölge (${near.length} nokta): yarnDensity ${range('rho')}, warpCrimpShare ${range('beta')}, ρ ${range('k')}, c ${range('c')}`,
);
console.log('  Not: yarnDensity yalnız kayıtta yoğunluğu verilmemiş slotlara uygulanır.');
const edges: string[] = [];
if (best.rho <= 0.6 + 1e-9 || best.rho >= 1.1 - 1e-9) edges.push('yarnDensity');
if (best.beta <= 0.2 + 1e-9 || best.beta >= 0.6 - 1e-9) edges.push('warpCrimpShare');
if (best.k === 1 || best.k === 32) edges.push('ρ');
if (best.c <= 0.7 + 1e-9 || best.c >= 1.0 - 1e-9) edges.push('c');
if (edges.length) {
  console.log(`  UYARI: ${edges.join(', ')} arama aralığının sınırında; gerçek optimum aralık dışında olabilir veya veri tutarsız.`);
}
const withOpen = records.filter((r) => r.measured.openPct).length;
if (withOpen < 3) {
  console.log(`  UYARI: açıklık ölçümü olan ${withOpen} kayıt var; ρ ve c'yi ayırmak için farklı örgülerden en az 3 kayıt gerekir.`);
}
if (records.length < 4) console.log(`  UYARI: ${records.length} kayıtla 4 parametre güvenilir biçimde ayrıştırılamaz.`);
if (records.some((r) => r.example)) console.log('  UYARI: [ÖRNEK] kayıtların ölçümleri uydurmadır.');

table(
  `Önerilen parametrelerle (yarnDensity ${best.rho.toFixed(2)}, kıvrım payı ${best.beta.toFixed(2)}, ρ ${best.k}, c ${best.c.toFixed(2)}):`,
  best,
  true,
);
