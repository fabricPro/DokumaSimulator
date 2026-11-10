import { useState, type ReactNode } from 'react';
import { ReedPanel } from './ReedPanel';
import { WeftReportField } from './WeftReportField';
import { bukumTurM, sonucNumara, type IplikTanimi, type IplikTip, type Parlaklik } from '../adapters/iplik';
import {
  DEFAULT_RELAX,
  appliedShrinkPct,
  buildFabricPositions,
  MAX_SLOTS,
  SLOT_NAMES,
  diameterMm,
  effectiveLoomWarpDensity,
  effectiveLoomWeftDensity,
  finishedDensities,
  toTex,
  type FabricSpec,
  type YarnSlot,
  type YarnSystem,
} from '../render-engine';

const SYSTEMS: YarnSystem[] = ['Ne', 'Nm', 'Dtex', 'Denier', 'Tex'];

/* ------------------------------ ortak ------------------------------ */

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format = (v) => String(v),
}: {
  label: ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <label className="slider">
      <span className="slider-label">
        {label}
        <b>{format(value)}</b>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
    </label>
  );
}

function NumberField({
  label,
  value,
  step = 1,
  min = 0,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  step?: number;
  min?: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  return (
    <label className="numfield">
      <span>{label}</span>
      <span className="numfield-input">
        <input
          type="number"
          step={step}
          min={min}
          value={value}
          onChange={(e) => {
            const v = +e.target.value;
            if (Number.isFinite(v) && v >= min) onChange(v);
          }}
        />
        {suffix && <em>{suffix}</em>}
      </span>
    </label>
  );
}

function normalizeHex(c: string): string {
  const h = c.trim().replace(/^#/, '');
  if (/^[0-9a-f]{6}$/i.test(h)) return '#' + h.toLowerCase();
  if (/^[0-9a-f]{3}$/i.test(h)) return '#' + h.split('').map((x) => x + x).join('').toLowerCase();
  return '#888888';
}

/* ------------------------------ slot kartı ------------------------------ */

function SlotCard({
  slot,
  onChange,
  onRemove,
  yarn,
  onYarn,
}: {
  slot: YarnSlot;
  onChange: (s: YarnSlot) => void;
  onRemove?: () => void;
  /** Slota bağlı iplik tanımı (.atki.json desenleri); varsa tip / kat / parlaklık / tüylülük / büküm düzenlenir. */
  yarn?: IplikTanimi;
  onYarn?: (y: IplikTanimi) => void;
}) {
  const [open, setOpen] = useState(false);
  let info = '';
  try {
    const tex = toTex(slot.count, slot.system);
    info = `${tex.toFixed(1)} tex · ⌀ ${diameterMm(tex, slot.yarnDensity ?? 0.85).toFixed(3)} mm`;
  } catch {
    info = 'geçersiz numara';
  }
  return (
    <div className="slot-card">
      <div className="slot-head">
        <span className="slot-badge" style={{ background: slot.color }}>
          {slot.name}
        </span>
        <input
          type="number"
          min={0.1}
          step={slot.system === 'Ne' || slot.system === 'Nm' ? 0.5 : 10}
          value={slot.count}
          onChange={(e) => +e.target.value > 0 && onChange({ ...slot, count: +e.target.value })}
          title="İplik numarası"
        />
        <select value={slot.system} onChange={(e) => onChange({ ...slot, system: e.target.value as YarnSystem })}>
          {SYSTEMS.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <input type="color" value={normalizeHex(slot.color)} onChange={(e) => onChange({ ...slot, color: e.target.value })} />
        <button className="icon" onClick={() => setOpen(!open)} title="Gelişmiş">
          {open ? '▴' : '▾'}
        </button>
        {onRemove && (
          <button className="icon" onClick={onRemove} title="Slotu kaldır">
            ×
          </button>
        )}
      </div>
      <div className="slot-info">{yarn ? `${yarn.ad} · ${info}` : info}</div>
      {open && yarn && onYarn && <YarnFields yarn={yarn} onYarn={onYarn} />}
      {open && (
        <div className="slot-adv">
          <NumberField
            label="İplik yoğunluğu (g/cm³)"
            value={slot.yarnDensity ?? 0.85}
            step={0.01}
            min={0.1}
            onChange={(v) => onChange({ ...slot, yarnDensity: v })}
          />
          <label className="numfield">
            <span>Büküm</span>
            <select value={slot.twist} onChange={(e) => onChange({ ...slot, twist: e.target.value as 'S' | 'Z' })}>
              <option value="S">S</option>
              <option value="Z">Z</option>
            </select>
          </label>
        </div>
      )}
    </div>
  );
}

const TIPLER: Array<[IplikTip, string]> = [
  ['egrilmis', 'Eğrilmiş'],
  ['filament', 'Filament'],
  ['teksture', 'Tekstüre'],
  ['yassi', 'Yassı bant'],
];
const PARLAKLIKLAR: Array<[Parlaklik, string]> = [
  ['mat', 'Mat'],
  ['yari-mat', 'Yarı mat'],
  ['parlak', 'Parlak'],
];

/** İplik tanımı alanları (tek kat numarası, kat, tip, parlaklık, tüylülük, büküm). */
function YarnFields({ yarn, onYarn }: { yarn: IplikTanimi; onYarn: (y: IplikTanimi) => void }) {
  const level = typeof yarn.bukum === 'number' ? 'ozel' : yarn.bukum;
  return (
    <div className="slot-adv">
      <NumberField label="Tek kat numara" value={yarn.numara} step={0.5} min={0.1} onChange={(v) => v > 0 && onYarn({ ...yarn, numara: v })} />
      <NumberField label="Kat sayısı" value={yarn.katSayisi} step={1} min={1} onChange={(v) => onYarn({ ...yarn, katSayisi: Math.max(1, Math.round(v)) })} />
      <label className="numfield">
        <span>Tip</span>
        <select value={yarn.tip} onChange={(e) => onYarn({ ...yarn, tip: e.target.value as IplikTip })}>
          {TIPLER.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label className="numfield">
        <span>Parlaklık</span>
        <select value={yarn.parlaklik} onChange={(e) => onYarn({ ...yarn, parlaklik: e.target.value as Parlaklik })}>
          {PARLAKLIKLAR.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <NumberField label="Tüylülük (0–1)" value={yarn.tuyluluk} step={0.05} min={0} onChange={(v) => onYarn({ ...yarn, tuyluluk: Math.min(1, Math.max(0, v)) })} />
      <label className="numfield">
        <span>Büküm</span>
        <select
          value={level}
          onChange={(e) => {
            const v = e.target.value;
            onYarn({ ...yarn, bukum: v === 'ozel' ? Math.round(bukumTurM(yarn)) : (v as 'az' | 'orta' | 'yuksek') });
          }}
        >
          <option value="az">Az</option>
          <option value="orta">Orta</option>
          <option value="yuksek">Yüksek</option>
          <option value="ozel">Tur/m</option>
        </select>
      </label>
      {typeof yarn.bukum === 'number' ? (
        <NumberField label="Büküm (tur/m)" value={yarn.bukum} step={10} min={0} onChange={(v) => onYarn({ ...yarn, bukum: Math.max(0, v) })} />
      ) : (
        <div className="slot-info">≈ {Math.round(bukumTurM(yarn))} tur/m</div>
      )}
    </div>
  );
}

/** İplik tanımı değişince ona bağlı slotların numarası / sistemi aynalanır. */
function withYarn(spec: FabricSpec, y: IplikTanimi): FabricSpec {
  const mirror = (list: YarnSlot[]) =>
    list.map((s) => (s.yarnId === y.id ? { ...s, count: sonucNumara(y.numara, y.katSayisi, y.birim), system: y.birim } : s));
  return {
    ...spec,
    yarns: (spec.yarns ?? []).map((x) => (x.id === y.id ? y : x)),
    warpSlots: mirror(spec.warpSlots),
    weftSlots: mirror(spec.weftSlots),
  };
}

/* ------------------------------ rapor dizisi ------------------------------ */

export function SequenceEditor({
  sequence,
  slots,
  onChange,
}: {
  sequence: number[];
  slots: YarnSlot[];
  onChange: (s: number[]) => void;
}) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [text, setText] = useState<string | null>(null);
  const asText = sequence.map((s) => SLOT_NAMES[s]).join(' ');
  const commitText = () => {
    if (text === null) return;
    const letters = text.toUpperCase().replace(/[^A-D]/g, '').split('');
    const seq = letters.map((l) => SLOT_NAMES.indexOf(l as any)).filter((i) => i >= 0 && i < slots.length);
    if (seq.length) onChange(seq);
    setText(null);
  };
  return (
    <div className="sequence">
      <div className="chips">
        {sequence.map((s, i) => (
          <span
            key={i}
            className={'chip' + (dragFrom === i ? ' dragging' : '')}
            style={{ borderColor: slots[s]?.color }}
            draggable
            onDragStart={() => setDragFrom(i)}
            onDragEnd={() => setDragFrom(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragFrom === null || dragFrom === i) return;
              const out = [...sequence];
              const [m] = out.splice(dragFrom, 1);
              out.splice(i, 0, m);
              onChange(out);
              setDragFrom(null);
            }}
            onClick={() => onChange(sequence.map((v, k) => (k === i ? (v + 1) % slots.length : v)))}
            onContextMenu={(e) => {
              e.preventDefault();
              if (sequence.length > 1) onChange(sequence.filter((_, k) => k !== i));
            }}
            title="Tıkla: slot değiştir · sürükle: sırala · sağ tık: sil"
          >
            {SLOT_NAMES[s]}
          </span>
        ))}
        <button className="chip add" onClick={() => onChange([...sequence, sequence[sequence.length - 1] ?? 0])}>
          +
        </button>
      </div>
      <input
        className="seq-text"
        value={text ?? asText}
        onChange={(e) => setText(e.target.value)}
        onBlur={commitText}
        onKeyDown={(e) => e.key === 'Enter' && commitText()}
        title="Harflerle yaz: A A B A C D"
      />
    </div>
  );
}

/* ------------------------------ iplik paneli ------------------------------ */

function remapSequence(seq: number[], removed: number): number[] {
  return seq.map((s) => (s === removed ? 0 : s > removed ? s - 1 : s));
}

function SideSlots({
  title,
  slots,
  sequence,
  onChange,
  yarns,
  onYarn,
}: {
  title: string;
  slots: YarnSlot[];
  sequence: number[];
  onChange: (slots: YarnSlot[], sequence: number[]) => void;
  yarns?: IplikTanimi[];
  onYarn?: (y: IplikTanimi) => void;
}) {
  const rename = (list: YarnSlot[]) => list.map((s, i) => ({ ...s, name: SLOT_NAMES[i] }));
  return (
    <div className="side-slots">
      <h4>{title}</h4>
      {slots.map((s, i) => (
        <SlotCard
          key={i}
          slot={s}
          onChange={(ns) => onChange(slots.map((x, k) => (k === i ? ns : x)), sequence)}
          yarn={s.yarnId ? yarns?.find((y) => y.id === s.yarnId) : undefined}
          onYarn={onYarn}
          onRemove={slots.length > 1 ? () => onChange(rename(slots.filter((_, k) => k !== i)), remapSequence(sequence, i)) : undefined}
        />
      ))}
      {slots.length < MAX_SLOTS && (
        <button
          className="add-slot"
          onClick={() => onChange(rename([...slots, { ...slots[slots.length - 1], color: '#b0b0b0' }]), sequence)}
        >
          + Slot {SLOT_NAMES[slots.length]}
        </button>
      )}
      <div className="seq-label">Rapor dizisi ({sequence.length})</div>
      <SequenceEditor sequence={sequence} slots={slots} onChange={(seq) => onChange(slots, seq)} />
    </div>
  );
}

export function YarnPanel({ spec, onChange }: { spec: FabricSpec; onChange: (s: FabricSpec) => void }) {
  return (
    <section className="panel">
      <h3>İplikler</h3>
      <SideSlots
        title="Çözgü"
        slots={spec.warpSlots}
        sequence={spec.warpSequence}
        onChange={(warpSlots, warpSequence) => onChange({ ...spec, warpSlots, warpSequence })}
        yarns={spec.yarns}
        onYarn={(y) => onChange(withYarn(spec, y))}
      />
      <SideSlots
        title="Atkı (alttan)"
        slots={spec.weftSlots}
        sequence={spec.weftSequence}
        onChange={(weftSlots, weftSequence) => onChange({ ...spec, weftSlots, weftSequence })}
        yarns={spec.yarns}
        onYarn={(y) => onChange(withYarn(spec, y))}
      />
    </section>
  );
}

/* ------------------------------ kumaş paneli ------------------------------ */

export function FabricPanel({ spec, onChange }: { spec: FabricSpec; onChange: (s: FabricSpec) => void }) {
  const set = <K extends keyof FabricSpec>(k: K, v: FabricSpec[K]) => onChange({ ...spec, [k]: v });
  const positions = buildFabricPositions(spec);
  const loomWarp = effectiveLoomWarpDensity(spec, positions);
  // Uygulanan çekme: fiziksel sınırı aşan giriş sınırda kalır (metrik ve render ile aynı)
  const applied = appliedShrinkPct(spec, positions);
  const fin = finishedDensities(loomWarp, effectiveLoomWeftDensity(spec), applied.warp, applied.weft);
  const relax = { ...DEFAULT_RELAX, ...(spec.relax ?? {}) };
  const [adv, setAdv] = useState(false);
  return (
    <section className="panel">
      <h3>Kumaş</h3>
      <div className="grid2">
        {spec.reed ? (
          <label
            className="numfield"
            title={`Tarak açıkken sıklık taraktan türetilir (düzenlenemez). Tarak kapanınca elle girilen ${spec.warpDensityLoom} tel/cm geri gelir.`}
          >
            <span>Tezgah çözgü sıklığı (taraktan)</span>
            <span className="numfield-input">
              <input type="number" value={+loomWarp.toFixed(2)} disabled />
              <em>tel/cm</em>
            </span>
          </label>
        ) : (
          <NumberField label="Tezgah çözgü sıklığı" suffix="tel/cm" value={spec.warpDensityLoom} step={0.5} min={1} onChange={(v) => set('warpDensityLoom', v)} />
        )}
        <NumberField label="Tezgah atkı sıklığı" suffix="atkı/cm" value={spec.weftDensityLoom} step={0.5} min={1} onChange={(v) => set('weftDensityLoom', v)} />
      </div>
      <ReedPanel spec={spec} onChange={onChange} />
      <WeftReportField spec={spec} onChange={onChange} />
      <Slider label="Çözgü çekmesi (boy)" value={spec.warpShrinkPct} min={0} max={30} step={0.5} onChange={(v) => set('warpShrinkPct', v)} format={(v) => `%${v}`} />
      <Slider label="Atkı çekmesi (en)" value={spec.weftShrinkPct} min={0} max={30} step={0.5} onChange={(v) => set('weftShrinkPct', v)} format={(v) => `%${v}`} />
      <Slider label="Kıvrım payı (çözgü)" value={spec.warpCrimpShare} min={0} max={1} step={0.01} onChange={(v) => set('warpCrimpShare', v)} format={(v) => v.toFixed(2)} />
      <p className="hint">
        Mamul: çözgü {fin.warp.toFixed(1)} tel/cm · atkı {fin.weft.toFixed(1)} atkı/cm
        {(applied.warp < spec.warpShrinkPct || applied.weft < spec.weftShrinkPct) && (
          <>
            {' '}
            · uygulanan çekme: boy %{applied.warp.toFixed(1)}, en %{applied.weft.toFixed(1)}
          </>
        )}
      </p>
      <button className="link" onClick={() => setAdv(!adv)}>
        {adv ? '▴' : '▾'} Çekme modeli (gelişmiş)
      </button>
      {adv && (
        <div className="grid2">
          <NumberField
            label="Racetrack katsayısı c"
            value={relax.c}
            step={0.01}
            min={0.3}
            onChange={(v) => set('relax', { ...spec.relax, c: v })}
          />
          <NumberField
            label="Sertlik oranı ρ"
            value={relax.rho}
            step={0.5}
            min={1}
            onChange={(v) => set('relax', { ...spec.relax, rho: v })}
          />
          <p className="hint" style={{ gridColumn: '1 / -1' }}>
            En küçük aralık m = c·(r₁+r₂) + w·d_karşı; sertlik k = 1 + (ρ−1)·w. Kalibrasyonla ayarlanır.
          </p>
        </div>
      )}
    </section>
  );
}
