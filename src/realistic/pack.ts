/**
 * FabricInput → GPU doku verileri (saf, testli).
 *
 *  - weave: R8UI, genişlik = rapordaki çözgü, yükseklik = rapordaki atkı; satır 0 = atkı 0 (alt).
 *    WebGL'de doku satır 0 v = 0'dadır, kumaşta da y = 0 alttır; ters çevirme yok.
 *  - warpColors / weftColors: RGBA8, n × 1 (sRGB renk, alfa 255).
 *  - warpTypes / weftTypes: R8UI, n × 1 (yarnTypes indeksi).
 *  - yarnTypes: RGBA32F, m × 2: satır 0 (çap mm, büküm tur/mm işaretli: S = −, Z = +, parlaklık 0/1/2, tüylülük);
 *    satır 1 (kat sayısı, yapı kodu STRUCTURE_CODE, 0, 0).
 */
import { DEFAULT_YARN_DENSITY, diameterMm, toTex } from './yarn';
import { axisLayout, type InputAxisLayout } from './layout';
import type { PackingOverrides } from './packing';
import { threadRand } from './hash';
import { colorOffsetOklab, linearToOklab, oklabToLinear, resolveIrregularity } from './irregularity';
import { srgbToLinear } from './surface';
import { pitchMm, pmod } from './scale';
import type { FabricInput, Luster, YarnType } from './types';

export const DEFAULT_TWIST_PER_M = 500;
/** İplik yapısı → shader kodu (iplik tablosu satır 3 .z, yarnTypes satır 1 .y). */
export const STRUCTURE_CODE: Record<NonNullable<YarnType['structure']>, number> = { spun: 0, tape: 1, filament: 2, textured: 3 };
/** VARSAYIM: tekstüre ipliğin kenar yumuşaklığı (kesit yarı genişliğinin oranı; kabarık lif saçağı). */
export const TEXTURED_EDGE_SOFT = 0.15;
const LUSTER_INDEX: Record<Luster, number> = { mat: 0, yarimat: 1, parlak: 2 };

export interface PackedFabric {
  weave: { width: number; height: number; data: Uint8Array };
  warpColors: Uint8Array;
  weftColors: Uint8Array;
  warpTypes: Uint8Array;
  weftTypes: Uint8Array;
  yarnTypes: Float32Array;
  counts: { warp: number; weft: number; yarnTypes: number };
}

export function hexToRgba(hex: string): [number, number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Geçersiz renk: ${hex} (#rrggbb bekleniyor)`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

export function validateInput(input: FabricInput): void {
  const { warps, wefts, data } = input.weave;
  if (!(Number.isInteger(warps) && warps > 0 && Number.isInteger(wefts) && wefts > 0)) {
    throw new Error('Örgü boyutu pozitif tamsayı olmalı.');
  }
  if (data.length !== warps * wefts) throw new Error(`Örgü verisi ${warps}×${wefts} = ${warps * wefts} olmalı, ${data.length} geldi.`);
  for (let k = 0; k < data.length; k++) if (data[k] > 1) throw new Error(`Örgü değeri 0/1 olmalı (indeks ${k}).`);
  if (input.warp.length === 0 || input.weft.length === 0) throw new Error('Çözgü ve atkı dizileri boş olamaz.');
  if (input.yarnTypes.length === 0 || input.yarnTypes.length > 255) throw new Error('İplik tipi sayısı 1–255 olmalı.');
  for (const [name, list] of [
    ['çözgü', input.warp],
    ['atkı', input.weft],
  ] as const) {
    list.forEach((t, i) => {
      if (!(Number.isInteger(t.yarnType) && t.yarnType >= 0 && t.yarnType < input.yarnTypes.length)) {
        throw new Error(`${name} ${i}: geçersiz iplik tipi ${t.yarnType}.`);
      }
    });
  }
  if (!(input.density.warpPerCm > 0 && input.density.weftPerCm > 0)) throw new Error('Sıklıklar pozitif olmalı.');
}

export function packFabric(input: FabricInput): PackedFabric {
  validateInput(input);
  const colors = (list: FabricInput['warp']) => {
    const out = new Uint8Array(list.length * 4);
    list.forEach((t, i) => out.set(hexToRgba(t.color), i * 4));
    return out;
  };
  const types = (list: FabricInput['warp']) => Uint8Array.from(list, (t) => t.yarnType);
  const m = input.yarnTypes.length;
  const yt = new Float32Array(m * 8);
  input.yarnTypes.forEach((y, i) => {
    const d = diameterMm(toTex(y.count, y.unit), y.yarnDensity ?? DEFAULT_YARN_DENSITY);
    const tpmm = (y.twistPerM ?? DEFAULT_TWIST_PER_M) / 1000;
    yt[i * 4] = d;
    yt[i * 4 + 1] = y.twist === 'S' ? -tpmm : tpmm;
    yt[i * 4 + 2] = LUSTER_INDEX[y.luster];
    yt[i * 4 + 3] = Math.max(0, Math.min(1, y.hairiness));
    yt[(m + i) * 4] = Math.max(1, y.plies ?? 2);
    yt[(m + i) * 4 + 1] = STRUCTURE_CODE[y.structure ?? 'spun'];
  });
  return {
    weave: { width: input.weave.warps, height: input.weave.wefts, data: input.weave.data },
    warpColors: colors(input.warp),
    weftColors: colors(input.weft),
    warpTypes: types(input.warp),
    weftTypes: types(input.weft),
    yarnTypes: yt,
    counts: { warp: input.warp.length, weft: input.weft.length, yarnTypes: input.yarnTypes.length },
  };
}

/**
 * fix-v3 iplik tablosu (GPU uThreads, RGBA32F, genişlik max(px, py), 8 satır): iplik başına sabitler bir kez
 * CPU'da; shader her pikselde 6 aday × ~8 pcg hash yerine 4 texel okur (G-buffer'ın ana ALU yükü buydu).
 * Satır 4·eksen + k (eksen 0 çözgü, 1 atkı), indeks mod döşeme periyodu:
 *   k = 0: (taban yarıçap mm = d/2·(1 + kalınlık·t₀), merkez kayması mm = konum·p·t₁, kesit en/boy A (sıkışma × yayılma), çap d)
 *   k = 1: (π·t₅, π·t₆, t₇, t₈)          — iplik boyunca kalınlık fazları, yol sapması genlikleri
 *   k = 2: (π·t₉, t₁₀, t₁₁, kenar yumuşaklığı) — yol fazı, lif dokusu ötelemesi, AA genişliği (tekstüre 0.15·a)
 *   k = 3: (±büküm tur/mm, kat, yapı kodu (STRUCTURE_CODE), 0)
 * tᵢ = threadRand(eksen, indeks mod periyot, kanal i) — shader'daki eski threadRand çağrılarıyla birebir.
 */
export function threadTable(
  input: FabricInput,
  period: [number, number],
  irregularityMul = 1,
  spreadMul = 1,
  packing?: PackingOverrides,
): { width: number; data: Float32Array; layouts: [InputAxisLayout, InputAxisLayout] } {
  const ir = resolveIrregularity(input, irregularityMul);
  const width = Math.max(period[0], period[1]);
  const data = new Float32Array(width * 8 * 4);
  const pitch = [pitchMm(input.density.warpPerCm), pitchMm(input.density.weftPerCm)];
  // Paketleme (packing.ts): merkez kayması (tarak / çekme konumları + hücre içine itme) ve kesit en/boyu
  const layouts: [InputAxisLayout, InputAxisLayout] = [
    axisLayout(input, 0, period[0], packing, spreadMul),
    axisLayout(input, 1, period[1], packing, spreadMul),
  ];
  for (const ax of [0, 1] as const) {
    const list = ax === 0 ? input.warp : input.weft;
    const lay = layouts[ax];
    for (let i = 0; i < period[ax]; i++) {
      const y = input.yarnTypes[list[pmod(i, list.length)].yarnType];
      const d = diameterMm(toTex(y.count, y.unit), y.yarnDensity ?? DEFAULT_YARN_DENSITY);
      const t = (ch: number) => threadRand(ax, i, ch, ir.seed);
      const row = (k: number, v: [number, number, number, number]) => data.set(v, ((ax * 4 + k) * width + i) * 4);
      const T = (y.twistPerM ?? DEFAULT_TWIST_PER_M) / 1000;
      row(0, [0.5 * d * (1 + ir.thickness * t(0)), lay.offset[i] + ir.position * pitch[ax] * t(1), lay.aspect[i], d]);
      row(1, [Math.PI * t(5), Math.PI * t(6), t(7), t(8)]);
      row(2, [Math.PI * t(9), t(10), t(11), y.structure === 'textured' ? TEXTURED_EDGE_SOFT : 0]);
      row(3, [y.twist === 'S' ? -T : T, Math.max(1, y.plies ?? 2), STRUCTURE_CODE[y.structure ?? 'spun'], 0]);
    }
  }
  return { width, data, layouts };
}

/**
 * fix-v3 iplik renk tablosu (GPU uThreadColor, RGBA32F, genişlik max(px, py), 2 satır: çözgü, atkı): doğrusal
 * albedo + Faz 4 OKLab renk sapması (eskiden ışık geçişinde her pikselde iki kez OKLab dönüşümü yapılıyordu).
 */
export function threadColors(
  input: FabricInput,
  period: [number, number],
  irregularityMul = 1,
  withTone = true,
): { width: number; data: Float32Array } {
  const ir = resolveIrregularity(input, irregularityMul);
  // withTone = false: ton sapması döşemeye konmaz (renderer onu görüntülemede uzun periyotlu tablodan uygular)
  if (!withTone) ir.colorDeltaE = 0;
  const width = Math.max(period[0], period[1]);
  const data = new Float32Array(width * 2 * 4);
  for (const ax of [0, 1] as const) {
    const list = ax === 0 ? input.warp : input.weft;
    for (let i = 0; i < period[ax]; i++) {
      const [r, g, b] = hexToRgba(list[pmod(i, list.length)].color);
      let lin: [number, number, number] = [srgbToLinear(r / 255), srgbToLinear(g / 255), srgbToLinear(b / 255)];
      if (ir.colorDeltaE > 0) {
        const lab = linearToOklab(lin);
        const dl = colorOffsetOklab(ax, i, ir);
        lin = oklabToLinear([lab[0] + dl[0], lab[1] + dl[1], lab[2] + dl[2]]).map((c) => Math.max(0, c)) as [number, number, number];
      }
      data.set([lin[0], lin[1], lin[2], 1], (ax * width + i) * 4);
    }
  }
  return { width, data };
}
