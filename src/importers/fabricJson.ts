import type { FabricSpec, YarnSpec, YarnSystem } from '../render-engine';

const SYSTEMS: YarnSystem[] = ['Ne', 'Nm', 'Dtex', 'Denier'];

function checkYarn(y: unknown, name: string): YarnSpec {
  const o = y as Partial<YarnSpec> | undefined;
  if (!o || typeof o.count !== 'number' || !(o.count > 0)) throw new Error(`${name}.count pozitif sayı olmalı.`);
  if (!SYSTEMS.includes(o.system as YarnSystem)) throw new Error(`${name}.system ${SYSTEMS.join('/')} olmalı.`);
  if (o.fiberDensity !== undefined && !(typeof o.fiberDensity === 'number' && o.fiberDensity > 0)) {
    throw new Error(`${name}.fiberDensity pozitif sayı olmalı.`);
  }
  return { count: o.count, system: o.system as YarnSystem, ...(o.fiberDensity ? { fiberDensity: o.fiberDensity } : {}) };
}

/** JSON metnini doğrulanmış FabricSpec'e çevirir. */
export function parseFabricJson(text: string): FabricSpec {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error('Geçersiz JSON: ' + (e as Error).message);
  }
  if (!raw || typeof raw !== 'object') throw new Error('JSON bir nesne olmalı.');
  const weave = raw.weave;
  if (!Array.isArray(weave) || weave.length === 0 || !Array.isArray(weave[0])) {
    throw new Error('weave boolean[][] olmalı.');
  }
  const w = weave[0].length;
  const norm: boolean[][] = weave.map((row: unknown, i: number) => {
    if (!Array.isArray(row) || row.length !== w) throw new Error(`weave satırı ${i} genişliği ${w} olmalı.`);
    return row.map((v) => v === true || v === 1);
  });
  const colors = (v: unknown, name: string) => {
    if (!Array.isArray(v) || v.length === 0 || !v.every((c) => typeof c === 'string')) {
      throw new Error(`${name} boş olmayan renk dizisi olmalı.`);
    }
    return v as string[];
  };
  const num = (v: unknown, name: string, int = false) => {
    if (typeof v !== 'number' || !(v > 0) || (int && !Number.isInteger(v))) {
      throw new Error(`${name} pozitif ${int ? 'tamsayı' : 'sayı'} olmalı.`);
    }
    return v;
  };
  return {
    weave: norm,
    warpColors: colors(raw.warpColors, 'warpColors'),
    weftColors: colors(raw.weftColors, 'weftColors'),
    warpYarn: checkYarn(raw.warpYarn, 'warpYarn'),
    weftYarn: checkYarn(raw.weftYarn, 'weftYarn'),
    warpDensity: num(raw.warpDensity, 'warpDensity'),
    weftDensity: num(raw.weftDensity, 'weftDensity'),
    repeatX: num(raw.repeatX ?? 1, 'repeatX', true),
    repeatY: num(raw.repeatY ?? 1, 'repeatY', true),
  };
}

export function serializeFabricJson(spec: FabricSpec): string {
  return JSON.stringify(spec, null, 2);
}
