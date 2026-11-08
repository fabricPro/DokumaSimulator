/**
 * Kalibrasyon: calibration/samples/*.json kayıtlarını simülasyonla karşılaştırır ve
 * yarnDensity (verilmemiş slotlar için varsayılan) ile warpCrimpShare için ızgara araması yapar.
 *
 *   npm run calibrate                 → calibration/samples
 *   npm run calibrate -- <klasör>     → başka klasör
 *
 * Simülasyon girdisi olarak ölçülen çekmeler kullanılır; böylece sıklık sapması tezgah sıklığı
 * ile çekme ölçümünün tutarlılığını, gramaj sapması iplik çapı/kıvrım modelini gösterir.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeMetrics, normalizeSystem, SLOT_NAMES, type FabricSpec, type YarnSlot } from '../src/render-engine';
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
  measured: { warpDensity?: number; weftDensity?: number; warpShrinkPct?: number; weftShrinkPct?: number; gsm?: number };
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
  };
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

const pct = (sim: number, meas?: number) => (meas ? ((sim - meas) / meas) * 100 : NaN);
const f1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '—');
const fp = (v: number) => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(1) + '%' : '—');

function table(title: string, opts: { defaultYarnDensity?: number; warpCrimpShareOverride?: number }) {
  console.log(`\n${title}`);
  const rows = records.map((r, k) => {
    const m = computeMetrics(specs[k], opts);
    const ms = r.measured;
    return {
      numune: (r.example ? '[ÖRNEK] ' : '') + r.name,
      'çözgü sim': f1(m.Dw),
      'çözgü ölç': f1(ms.warpDensity ?? NaN),
      'çözgü sap': fp(pct(m.Dw, ms.warpDensity)),
      'atkı sim': f1(m.Df),
      'atkı ölç': f1(ms.weftDensity ?? NaN),
      'atkı sap': fp(pct(m.Df, ms.weftDensity)),
      'g/m² sim': f1(m.gsm),
      'g/m² ölç': f1(ms.gsm ?? NaN),
      'g/m² sap': fp(pct(m.gsm, ms.gsm)),
    };
  });
  console.table(rows);
}

table('Mevcut parametrelerle (yarnDensity 0.85 / kayıttaki kıvrım payı):', {});

// --- ızgara araması ---
const withGsm = records.map((r, k) => ({ r, s: specs[k] })).filter((x) => x.r.measured.gsm);
if (withGsm.length === 0) {
  console.log('\nGramaj ölçümü olan kayıt yok; ızgara araması atlandı.');
  process.exit(0);
}
let best = { rho: 0.85, beta: 0.4, err: Infinity };
const near: Array<{ rho: number; beta: number }> = [];
const grid: Array<{ rho: number; beta: number; err: number }> = [];
for (let rho = 0.6; rho <= 1.1 + 1e-9; rho += 0.01) {
  for (let beta = 0.2; beta <= 0.6 + 1e-9; beta += 0.02) {
    let err = 0;
    for (const { r, s } of withGsm) {
      const m = computeMetrics(s, { defaultYarnDensity: rho, warpCrimpShareOverride: beta });
      err += ((m.gsm - r.measured.gsm!) / r.measured.gsm!) ** 2;
    }
    grid.push({ rho, beta, err });
    if (err < best.err) best = { rho, beta, err };
  }
}
const rms = (e: number) => Math.sqrt(e / withGsm.length) * 100;
for (const g of grid) if (rms(g.err) <= rms(best.err) + 0.25) near.push(g);
const rhoRange = [Math.min(...near.map((n) => n.rho)), Math.max(...near.map((n) => n.rho))];
const betaRange = [Math.min(...near.map((n) => n.beta)), Math.max(...near.map((n) => n.beta))];

console.log('\nIzgara araması (yarnDensity 0.60–1.10 × warpCrimpShare 0.20–0.60, hedef: gramaj sapması kareleri):');
console.log(`  Öneri: yarnDensity = ${best.rho.toFixed(2)}, warpCrimpShare = ${best.beta.toFixed(2)}  (RMS gramaj sapması %${rms(best.err).toFixed(2)})`);
console.log(
  `  En iyiye %0.25 yakın bölge: yarnDensity ${rhoRange[0].toFixed(2)}–${rhoRange[1].toFixed(2)}, ` +
    `warpCrimpShare ${betaRange[0].toFixed(2)}–${betaRange[1].toFixed(2)} (${near.length} nokta)`,
);
console.log('  Not: yarnDensity yalnız kayıtta yoğunluğu verilmemiş slotlara uygulanır.');
if (withGsm.length < 3) {
  console.log(
    `  UYARI: ${withGsm.length} gramaj ölçümüyle iki parametre güvenilir biçimde ayrıştırılamaz; ` +
      'farklı örgü ve iplik kombinasyonlarından daha çok kayıt ekleyin.',
  );
}
if (records.some((r) => r.example)) console.log('  UYARI: [ÖRNEK] kayıtların ölçümleri uydurmadır.');

table(`Önerilen parametrelerle (yarnDensity ${best.rho.toFixed(2)}, warpCrimpShare ${best.beta.toFixed(2)}):`, {
  defaultYarnDensity: best.rho,
  warpCrimpShareOverride: best.beta,
});
