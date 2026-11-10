/**
 * Geometri modeli (saf; G-buffer shader'ının CPU ikizi — adımlar birebir).
 *
 * Kaynak: render-engine/physical/simulate.ts "fields" geçişi (reference/weave_phys.py karşılığı):
 *  - iplik merkezleri: (i + 0.5)·p + kayma(i) (Faz 4 düzensizliği; kapalıyken eşit aralık);
 *  - krepaj: iplik boyunca, çapraz iplik merkezleri arasında smoothstep geçişi;
 *    genlik D·β (çözgü) ve D·(1 − β) (atkı), D = r_çözgü + r_en yakın atkı, β = krepaj payı (0.4).
 *    Uzun flottede komşu durumlar aynı olduğu için dalga düzleşir; sık bağlantıda dalgalanır.
 *  - üstte olan: yüksekliği büyük olan iplik (eşitlikte çözgü), ikisi de yoksa zemin.
 *  - Kayma/kalınlık komşu hücreye taşabildiği için her eksende i−1, i, i+1 adayları denenir.
 *
 * Kesit elips: yarı genişlik a = r·√k, yarı yükseklik b = r/√k (kesit alanı πr² korunur).
 * Yükseklik profili 0.6·b·√(1 − (d/a)²): 0.6 çarpanı referanstan (görsel basıklık); k = 1 ve
 * düzensizlik kapalıyken referansla birebir aynıdır.
 *
 * İki parametre seti (`model`):
 *  - 'classic': yukarıdaki model (CPU heightfield ile tutarlılık kontrolü ve eski testler bununla);
 *  - 'v2' (fix-v3): TEMAS TABANLI iplik yolu. Her kesişimde üstteki ve alttaki ipliğin merkezleri arasındaki
 *    dikey mesafe b_üst + b_alt (b = kesit yarı yüksekliği; sıkışma yoksa b = r). Pay β çözgüye, 1 − β atkıya:
 *    z_çözgü = ±β·D, z_atkı = ∓(1 − β)·D. Merkez hattı ardışık kesişim z'lerinden cosine geçişle geçer.
 *    Uzun atlamada (aynı durumun ardışık koşusu) D koşudaki en kalın çapraz iplikle alınır → iplik flotte
 *    boyunca düz kalır, inmez. Kalın / ince ipliğin yarıçapı geometriye doğrudan girer ("en yakın komşu" yok).
 *    Kesit: eğrilmiş iplikte yuvarlağa yakın; basıklık yalnız sıkışmadan (d/p > 0.8), en/boy ≤ 1.4; 'tape' 3.
 */
import type { FabricInput } from './types';
import { DEFAULT_YARN_DENSITY, diameterMm, toTex } from './yarn';
import { pitchMm, pmod } from './scale';
import { positionOffset, resolveIrregularity, thicknessScale } from './irregularity';
import { axisLayout, type InputAxisLayout } from './layout';
import type { PackingOverrides } from './packing';
import { tileFor } from './tile';

/**
 * v2 aday yarı penceresi: en geniş yarı kesit (+ iplik boyunca kalınlık %7, düzensizlik) en küçük merkez aralığının
 * kaç katı. 1 → krepaj aralığının iki ucu; s → k+1−s .. k+s. Üst sınır 8 (shader döngüsü).
 */
export function layoutSpan(l: InputAxisLayout, thickness = 0, position = 0): number {
  const reach = l.maxHalfWidth * (1 + thickness) * 1.07 * 1.15 + 2 * position * l.pitch;
  return Math.max(1, Math.min(8, 1 + Math.floor(reach / l.minGap)));
}

/** VARSAYIM (kalibre edilecek): basıklık k = 1 + 1.2·max(0, d/p − 0.6), [1, 2.2] aralığında.
 *  d/p: iplik çapı / iplik aralığı (doluluk). Doluluk 0.6'yı aşınca iplik yanlara yayılır.
 *  factor: 0 → hep daire (tutarlılık testi), 1 → varsayılan model. */
export const FLATTEN_SLOPE = 1.2;
export const FLATTEN_START = 0.6;
export const FLATTEN_MAX = 2.2;
export const PROFILE_SCALE = 0.6;
export const DEFAULT_CRIMP_SHARE = 0.4;

/** v2 (fix-v3) sabitleri. */
export const V2_PROFILE_SCALE = 1.0;
/**
 * VARSAYIM (kalibre edilecek): v2 krepaj payı (girdide crimpShare yoksa). fix-v2 prototip genlikleri
 * 0.45·r (çözgü) / 0.40·r (atkı), oran ≈ 0.53 → dengeli 0.5.
 */
export const V2_CRIMP_SHARE = 0.5;
/** VARSAYIM: sıkışma basıklığı k = 1 + 0.8·max(0, d/p − 0.8), en/boy (= k) ≤ 1.4. Yassı bant: k = 3. */
export const V2_FLATTEN_START = 0.8;
export const V2_FLATTEN_SLOPE = 0.8;
export const V2_FLATTEN_MAX = 1.4;
export const TAPE_ASPECT = 3;
/**
 * VARSAYIM (kalibre edilecek): sık dokuda sıkışma — iplikler ezilip iç içe geçtiği için kesişimde merkezler arası
 * mesafe b_üst + b_alt'tan küçülür: D_etkin = c·(b_üst + b_alt), c = 1 − 0.57·smoothstep((d/p − 0.5) / 0.35),
 * d/p kesişimdeki iki ipliğin doluluğunun büyüğü. Açık dokuda (d/p ≤ 0.5) c = 1 (saf temas); bantlı fixture'da
 * (d/p ≈ 0.84) c ≈ 0.43 → toplam ≈ 0.86·r, fix-v2 prototip genlikleri (0.45·r + 0.40·r) ile aynı.
 */
export const COMPRESS_START = 0.5;
export const COMPRESS_RANGE = 0.35;
export const COMPRESS_MAX = 0.57;
export function compressionFactor(fill: number): number {
  return 1 - COMPRESS_MAX * smoothstep01((fill - COMPRESS_START) / COMPRESS_RANGE);
}

/** Uzun atlama koşusu arama sınırı (kesişim). */
export const FLOAT_RUN_MAX = 16;
/** Zemin payı: en alçak iplik altının bu kadar r_max altında. */
export const BG_MARGIN = 0.6;
export type GeometryModel = 'classic' | 'v2';

/** VARSAYIM: filament sıkışmada belirgin yassılaşır — üst sınır 2.0 (eğrilmiş / tekstüre 1.4). */
export const FILAMENT_FLATTEN_MAX = 2.0;

/** v2 kesit basıklığı (en/boy). factor: Tuning.flattening; structure: iplik yapısı (YarnType.structure). */
export function flatteningV2(diameterMm: number, pitchMm: number, factor = 1, structure?: string): number {
  if (structure === 'tape') return TAPE_ASPECT;
  const k = 1 + factor * V2_FLATTEN_SLOPE * Math.max(0, diameterMm / pitchMm - V2_FLATTEN_START);
  return Math.min(structure === 'filament' ? FILAMENT_FLATTEN_MAX : V2_FLATTEN_MAX, Math.max(1, k));
}

/**
 * İplik yayılması (Durak 2-E): kesit, komşu aralığı ve sıkışmaya göre genişler; yüksekliği alanı (hacmi) koruyacak
 * şekilde azalır (a = r·√A, b = r/√A, A = en/boy). Sert yuvarlak çubuk modelinde sık dokuda iplik konum / kalınlık
 * düzensizliği boşluk açıyor, görsel açıklık örtme metriğinden büyük çıkıyordu (bantlı çözgü +6 puan).
 * İki bileşen (d/p = doluluk f):
 *  1) bağlantı basıncıyla yayılma: w₁ = d·(1 + (S_tip − 1)·smoothstep((f − 0.2) / 0.5));
 *  2) sık dokuda komşu boşluğunu kapatma: w = w₁ + (0.98·p − w₁)·C_tip·smoothstep((F − 0.6) / 0.25),
 *     F = max(kendi sisteminin doluluğu, çapraz sistemin ortalama doluluğu): sıkışma kumaşın iki yönüne birlikte
 *     bağlı (bantlı çözgüde çözgü 0.84 iken atkı 0.67); sıkışan iplik komşusuna doğru ezilir.
 * VARSAYIM (kalibre edilecek; demo desenler + bantlı çözgü + açık doku için görsel açıklık ↔ metrik ±3 puanla seçildi):
 *   S_tip: filament 1.30, tekstüre 1.22, tek katlı eğrilmiş 1.06, çok katlı eğrilmiş 1.04 (bükümlü katlar en az), bant 1;
 *   C_tip: filament 0.9, tekstüre 0.8, tek katlı 0.7, çok katlı 0.6.
 * Toplam en/boy = sıkışma basıklığı k · (w/d)², tipe göre üst sınır (eğrilmiş 1.6, tekstüre 1.8, filament 2.4, bant 3);
 * genişlik iplik aralığını aşmaz (≤ max(0.98·p, d)).
 */
export const SPREAD_MAX: Record<SpreadKind, number> = { filament: 1.3, textured: 1.22, spunSingle: 1.06, spunPlied: 1.04, tape: 1 };
export const SPREAD_CLOSE: Record<SpreadKind, number> = { filament: 0.9, textured: 0.8, spunSingle: 0.7, spunPlied: 0.6, tape: 0 };
type SpreadKind = 'filament' | 'textured' | 'spunSingle' | 'spunPlied' | 'tape';
/** En/boy üst sınırı. VARSAYIM: tek katlı eğrilmiş sınırlı yassılaşır (≤ 1.3; büküm lifleri bir arada tutar),
 *  çok katlı 1.6, tekstüre 1.8, filament 2.4 (lifler serbestçe yayılır), bant 3. */
const ASPECT_CAP: Record<string, number> = { spun: 1.6, spunSingle: 1.3, textured: 1.8, filament: 2.4, tape: TAPE_ASPECT };

function spreadKind(structure?: string, plies = 2): SpreadKind {
  if (structure === 'filament' || structure === 'textured' || structure === 'tape') return structure;
  return plies > 1 ? 'spunPlied' : 'spunSingle';
}

/** Yayılma oranı w/d (kesit genişliği / yuvarlak çap). */
export function spreadFactor(
  diameterMm: number,
  pitchMm: number,
  structure?: string,
  plies = 2,
  spreadMul = 1,
  crossFill = 0,
): number {
  const kind = spreadKind(structure, plies);
  const m = Math.max(0, spreadMul);
  const f = diameterMm / pitchMm;
  const F = Math.max(f, crossFill);
  const w1 = diameterMm * (1 + m * (SPREAD_MAX[kind] - 1) * smoothstep01((f - 0.2) / 0.5));
  const w = w1 + Math.max(0, 0.98 * pitchMm - w1) * Math.min(1, m * SPREAD_CLOSE[kind]) * smoothstep01((F - 0.6) / 0.25);
  return w / diameterMm;
}

/** Sistemlerin ortalama doluluğu (çap / aralık; rapor dizisi boyunca ortalama): [çözgü, atkı]. */
export function systemFill(input: FabricInput): [number, number] {
  const d = (t: number) => {
    const y = input.yarnTypes[t];
    return diameterMm(toTex(y.count, y.unit), y.yarnDensity ?? DEFAULT_YARN_DENSITY);
  };
  const mean = (list: FabricInput['warp']) => list.reduce((a, t) => a + d(t.yarnType), 0) / Math.max(1, list.length);
  return [mean(input.warp) / pitchMm(input.density.warpPerCm), mean(input.weft) / pitchMm(input.density.weftPerCm)];
}

/** Kesit en/boy oranı A (sıkışma basıklığı × yayılma²), tip üst sınırı ve aralık sınırıyla. */
export function crossSectionAspect(
  diameterMm: number,
  pitchMm: number,
  flattenFactor = 1,
  structure?: string,
  plies = 2,
  spreadMul = 1,
  crossFill = 0,
): number {
  if (structure === 'tape') return TAPE_ASPECT;
  const k = flatteningV2(diameterMm, pitchMm, flattenFactor, structure);
  const s = spreadFactor(diameterMm, pitchMm, structure, plies, spreadMul, crossFill);
  const capKey = (structure ?? 'spun') === 'spun' && plies <= 1 ? 'spunSingle' : (structure ?? 'spun');
  let A = Math.min(k * s * s, ASPECT_CAP[capKey] ?? 1.6);
  // genişlik d·√A aralığı aşmasın (iplik zaten aralıktan kalınsa yalnız yayılmaz)
  const wMax = Math.max(0.98 * pitchMm, diameterMm);
  if (diameterMm * Math.sqrt(A) > wMax) A = (wMax / diameterMm) ** 2;
  return Math.max(A, 1);
}

/**
 * v2 zemin: en alçak iplik altı ≥ −(2·max(β, 1−β) + 1)·r_max (merkez en fazla max(β, 1−β)·2·b_max iner,
 * b ≤ r); zemin bunun 0.6·r_max altında → hiçbir iplik zemine gömülmez.
 */
export function v2BgHeight(rMax: number, beta: number): number {
  return -(2 * Math.max(beta, 1 - beta) + 1 + BG_MARGIN) * rMax;
}

/** Cosine geçiş (1 − cos πs)/2 — prototipteki `sm`. */
export const cosStep01 = (t: number) => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return (1 - Math.cos(Math.PI * x)) / 2;
};

export function flattening(diameterMm: number, pitchMm: number, factor = 1): number {
  const k = 1 + factor * FLATTEN_SLOPE * Math.max(0, diameterMm / pitchMm - FLATTEN_START);
  return Math.min(FLATTEN_MAX, Math.max(1, k));
}

export function ellipseAxes(r: number, k: number): { a: number; b: number } {
  return { a: r * Math.sqrt(k), b: r / Math.sqrt(k) };
}

export const smoothstep01 = (t: number) => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
};

export interface GeometryParams {
  /** Hücre durumu: çözgü (global i) atkı (global j) üzerinde mi. */
  warpUp: (i: number, j: number) => boolean;
  /** Global çözgü / atkı yarıçapı (mm), düzensizlik dahil. */
  warpRadius: (i: number) => number;
  weftRadius: (j: number) => number;
  /** Global çözgü / atkı merkezi (mm), düzensizlik dahil. */
  warpCenter: (i: number) => number;
  weftCenter: (j: number) => number;
  pitchWarp: number;
  pitchWeft: number;
  crimpShare: number;
  /** Parametre seti; verilmezse 'classic'. */
  model?: GeometryModel;
  flattenFactor: number;
  /** Zemin yüksekliği. classic: −(en büyük çözgü r + en büyük atkı r)·1.4; v2: v2BgHeight. */
  bgHeight: number;
  /** v2: iplik kesit basıklığı k (en/boy); verilmezse 1. */
  warpFlat?: (i: number) => number;
  weftFlat?: (j: number) => number;
  /** v2: örgü rapor boyu (uzun atlama araması için). */
  weaveSize?: [number, number];
  /** v2 aday yarı penceresi (çözgü, atkı): krepaj aralığı (k, k+1) çevresinde k+1−s .. k+s. Shader uSpan ile aynı. */
  span?: [number, number];
}

/** Kesit yarı yüksekliği b = r/√k. */
const semiH = (r: number, k: number) => r / Math.sqrt(k);

/**
 * v2 temas modeli: kesişim (i, j)'de çözgü ve atkı merkez z'leri (mm).
 * D_çözgü = c·(b_w(i) + max b_f) (çözgünün bu kesişimi içeren aynı durum koşusunda),
 * D_atkı = c·(max b_w (atkının koşusunda) + b_f(j)), c = compressionFactor (açık dokuda 1).
 * Bağlantıda (koşu = 1) z_w − z_f = c·(b_w + b_f); açık dokuda = b_w + b_f.
 */
export function crossingZ(i: number, j: number, g: GeometryParams): { zw: number; zf: number; floatW: boolean; floatF: boolean } {
  const up = g.warpUp(i, j);
  const s = up ? 1 : -1;
  const beta = g.crimpShare;
  const kw = (k: number) => g.warpFlat?.(k) ?? 1;
  const kf = (k: number) => g.weftFlat?.(k) ?? 1;
  const [ww, wh] = g.weaveSize ?? [FLOAT_RUN_MAX, FLOAT_RUN_MAX];
  const bwi = semiH(g.warpRadius(i), kw(i));
  const bfj = semiH(g.weftRadius(j), kf(j));
  // Çözgü i boyunca (atkılar) aynı durum koşusu
  let bf = bfj;
  const limF = Math.min(FLOAT_RUN_MAX, wh);
  for (let d = 1; d < limF && g.warpUp(i, j + d) === up; d++) bf = Math.max(bf, semiH(g.weftRadius(j + d), kf(j + d)));
  for (let d = 1; d < limF && g.warpUp(i, j - d) === up; d++) bf = Math.max(bf, semiH(g.weftRadius(j - d), kf(j - d)));
  // Atkı j boyunca (çözgüler)
  let bw = bwi;
  const limW = Math.min(FLOAT_RUN_MAX, ww);
  for (let d = 1; d < limW && g.warpUp(i + d, j) === up; d++) bw = Math.max(bw, semiH(g.warpRadius(i + d), kw(i + d)));
  for (let d = 1; d < limW && g.warpUp(i - d, j) === up; d++) bw = Math.max(bw, semiH(g.warpRadius(i - d), kw(i - d)));
  // doluluk: çap / aralık (b ≈ r; basık iplikte biraz küçük kalır)
  const cw = compressionFactor(Math.max((2 * bwi) / g.pitchWarp, (2 * bf) / g.pitchWeft));
  const cf = compressionFactor(Math.max((2 * bw) / g.pitchWarp, (2 * bfj) / g.pitchWeft));
  // Uzun atlama bayrakları: bu kesişim, ipliğin aynı durum koşusunun (flotte) içinde mi
  const floatW = g.warpUp(i, j + 1) === up || g.warpUp(i, j - 1) === up;
  const floatF = g.warpUp(i + 1, j) === up || g.warpUp(i - 1, j) === up;
  return { zw: s * beta * cw * (bwi + bf), zf: -s * (1 - beta) * cf * (bw + bfj), floatW, floatF };
}

/**
 * Krepaj geçişi (iki kesişim arasında, t ∈ [0, 1]): cosine (1 − cos πt)/2. Bir uç flotte (uzun atlama) içindeyse iplik
 * oradan düz çıkar ve bükülme bağlantı ucunda yoğunlaşır: f = g^P (bükülme t = 1'de) ya da 1 − (1 − g)^P (t = 0'da).
 * Böylece flotteye komşu segment baştan sona eğimli kalmaz (segmentler arası ışık basamağı / "dikiş" yok); uçlarda
 * eğim 0, yol ve normal sürekli. VARSAYIM: P = 2 (bükülme boyu ≈ iplik yarıçapı mertebesi; 2.5 bağlantıda sert parlama çizgisi yaptı).
 */
export const CRIMP_FLOAT_EASE = 2;
export function crimpEase(t: number, float0: boolean, float1: boolean): { f: number; df: number } {
  const x = Math.min(1, Math.max(0, t));
  const g = (1 - Math.cos(Math.PI * x)) / 2;
  const dg = (Math.PI / 2) * Math.sin(Math.PI * x);
  const P = CRIMP_FLOAT_EASE;
  if (float0 && !float1) return { f: g ** P, df: P * g ** (P - 1) * dg };
  if (float1 && !float0) return { f: 1 - (1 - g) ** P, df: P * (1 - g) ** (P - 1) * dg };
  return { f: g, df: dg };
}

/**
 * v2 kesişim tablosu (GPU uCross dokusu, RGBA32F): döşeme periyodu (px × py kesişim) için (z_w, z_f, çözgü flotte,
 * atkı flotte), satır = atkı.
 * Düzensizlik (kalınlık) indeks mod periyotla — shader'daki threadRand ile aynı.
 */
export function crossingTable(g: GeometryParams, px: number, py: number): Float32Array {
  // Koşu araması periyot dışına taşınca da iplik başına değerler indeks mod periyotla (shader threadRand gibi)
  const gp: GeometryParams = {
    ...g,
    warpRadius: (i) => g.warpRadius(pmod(i, px)),
    weftRadius: (j) => g.weftRadius(pmod(j, py)),
  };
  const out = new Float32Array(px * py * 4);
  for (let j = 0; j < py; j++) {
    for (let i = 0; i < px; i++) {
      const z = crossingZ(i, j, gp);
      out.set([z.zw, z.zf, z.floatW ? 1 : 0, z.floatF ? 1 : 0], (j * px + i) * 4);
    }
  }
  return out;
}

export interface GeometrySample {
  height: number;
  /** 0 zemin, 1 çözgü, 2 atkı (G-buffer gb1.z ile aynı). */
  axis: 0 | 1 | 2;
  /** İplik indeksi i / j (orijinin solunda / altında negatif). */
  index: number;
  /**
   * Eski kimlik: +(i+1) çözgü, −(j+1) atkı, 0 zemin — CPU heightfield'ın topId'si ile karşılaştırma için.
   * Negatif indekslerde belirsizdir (çözgü −1 → 0); karar için `axis` + `index` kullanın.
   */
  id: number;
  /** Kesit içi konum −1..1 (zeminde 0). */
  v: number;
  /** Kesit yarı genişliği a (mm). */
  a: number;
  /** Yükseklik eğimi (dh/dx, dh/dy), mm/mm. */
  grad: [number, number];
}

/** x'e en yakın merkez (aday i−1, i, i+1). */
function nearest(x: number, pitch: number, center: (k: number) => number): number {
  const i = Math.floor(x / pitch);
  let best = i;
  let bd = Math.abs(x - center(i));
  for (const k of [i - 1, i + 1]) {
    const dd = Math.abs(x - center(k));
    if (dd < bd) {
      bd = dd;
      best = k;
    }
  }
  return best;
}

/** c(k0) ≤ x < c(k0+1) aralığı ve smoothstep kesri. */
function interval(x: number, pitch: number, center: (k: number) => number): { k0: number; s: number } {
  let k0 = Math.floor(x / pitch - 0.5);
  // Tarak / çekme konumlarında merkez eşit aralıktan birkaç aralık sapabilir (shader ile aynı sınırlı arama)
  for (let n = 0; n < 16 && x < center(k0); n++) k0 -= 1;
  for (let n = 0; n < 16 && x >= center(k0 + 1); n++) k0 += 1;
  const c0 = center(k0);
  const c1 = center(k0 + 1);
  return { k0, s: Math.min(1, Math.max(0, (x - c0) / (c1 - c0))) };
}

/** Kesit eğimi: d/dd [0.6·b·√(1−(d/a)²)] = −0.6·b·u / (a·√(1−u²)); kenarda sınırlanır. */
function slope(u: number, a: number, b: number, scale = PROFILE_SCALE): number {
  return (-scale * b * u) / (a * Math.sqrt(Math.max(1 - u * u, 0.0025)));
}

/** v2 (temas modeli) taban geometrisi — shader'daki taban adımlarıyla aynı (rölyef hariç). */
function geometryAtV2(X: number, Y: number, g: GeometryParams): GeometrySample {
  const pw = g.pitchWarp;
  const pf = g.pitchWeft;
  let best = { h: -1e3, axis: 0 as 0 | 1 | 2, index: 0, v: 0, a: 0, grad: [0, 0] as [number, number] };

  // Çözgü adayları: kesit x, yol y boyunca kesişim z'lerinden
  const iv = interval(Y, pf, g.weftCenter);
  const spanW = g.weftCenter(iv.k0 + 1) - g.weftCenter(iv.k0);
  const ihW = interval(X, pw, g.warpCenter).k0;
  const [sw, sf] = g.span ?? [1, 1];
  for (let i = ihW + 1 - sw; i <= ihW + sw; i++) {
    const { a, b } = ellipseAxes(g.warpRadius(i), g.warpFlat?.(i) ?? 1);
    const dx = X - g.warpCenter(i);
    if (!(Math.abs(dx) < a)) continue;
    const c0 = crossingZ(i, iv.k0, g);
    const c1 = crossingZ(i, iv.k0 + 1, g);
    const e = crimpEase(iv.s, c0.floatW, c1.floatW);
    const u = dx / a;
    const h = c0.zw + (c1.zw - c0.zw) * e.f + b * Math.sqrt(Math.max(0, 1 - u * u));
    if (h > best.h) best = { h, axis: 1, index: i, v: u, a, grad: [slope(u, a, b, 1), ((c1.zw - c0.zw) * e.df) / spanW] };
  }

  // Atkı adayları; eşitlikte çözgü üstte
  const ih = interval(X, pw, g.warpCenter);
  const spanF = g.warpCenter(ih.k0 + 1) - g.warpCenter(ih.k0);
  const bestWarpH = best.axis === 1 ? best.h : -1e3;
  for (let j = iv.k0 + 1 - sf; j <= iv.k0 + sf; j++) {
    const { a, b } = ellipseAxes(g.weftRadius(j), g.weftFlat?.(j) ?? 1);
    const dy = Y - g.weftCenter(j);
    if (!(Math.abs(dy) < a)) continue;
    const c0 = crossingZ(ih.k0, j, g);
    const c1 = crossingZ(ih.k0 + 1, j, g);
    const e = crimpEase(ih.s, c0.floatF, c1.floatF);
    const u = dy / a;
    const h = c0.zf + (c1.zf - c0.zf) * e.f + b * Math.sqrt(Math.max(0, 1 - u * u));
    if (h > best.h && h > bestWarpH) best = { h, axis: 2, index: j, v: u, a, grad: [((c1.zf - c0.zf) * e.df) / spanF, slope(u, a, b, 1)] };
  }

  if (best.axis === 0) return { height: g.bgHeight, axis: 0, index: 0, id: 0, v: 0, a: 0, grad: [0, 0] };
  const id = best.axis === 1 ? best.index + 1 : -(best.index + 1);
  return { height: best.h, axis: best.axis, index: best.index, id, v: best.v, a: best.a, grad: best.grad };
}

/** Bir kumaş noktasının (mm) G-buffer değerleri. Shader ile aynı adımlar. */
export function geometryAt(X: number, Y: number, g: GeometryParams): GeometrySample {
  if (g.model === 'v2') return geometryAtV2(X, Y, g);
  const pw = g.pitchWarp;
  const pf = g.pitchWeft;
  const beta = g.crimpShare;
  // classic (Faz 2)
  const prof = PROFILE_SCALE;
  const step = smoothstep01;
  // d(step)/ds = 6s(1−s)
  const dStep = (t: number) => 6 * t * (1 - t);
  const jN = nearest(Y, pf, g.weftCenter);
  const iN = nearest(X, pw, g.warpCenter);
  const rfN = g.weftRadius(jN);
  const rwN = g.warpRadius(iN);

  let best = { h: -1e3, axis: 0 as 0 | 1 | 2, index: 0, v: 0, a: 0, grad: [0, 0] as [number, number] };

  // Çözgü adayları: kesit x yönünde, krepaj y yönünde
  const iv = interval(Y, pf, g.weftCenter);
  const fW = step(iv.s);
  const dsW = dStep(iv.s) / (g.weftCenter(iv.k0 + 1) - g.weftCenter(iv.k0));
  const i0 = Math.floor(X / pw);
  for (const i of [i0 - 1, i0, i0 + 1]) {
    const rw = g.warpRadius(i);
    const k = flattening(2 * rw, pw, g.flattenFactor);
    const { a, b } = ellipseAxes(rw, k);
    const dx = X - g.warpCenter(i);
    if (!(Math.abs(dx) < a)) continue;
    const amp = (rw + rfN) * beta;
    const s0 = g.warpUp(i, iv.k0) ? 1 : -1;
    const s1 = g.warpUp(i, iv.k0 + 1) ? 1 : -1;
    const u = dx / a;
    const h = (s0 * (1 - fW) + s1 * fW) * amp + prof * b * Math.sqrt(Math.max(0, 1 - u * u));
    if (h > best.h) {
      best = { h, axis: 1, index: i, v: u, a, grad: [slope(u, a, b, prof), (s1 - s0) * amp * dsW] };
    }
  }

  // Atkı adayları: kesit y yönünde, krepaj x yönünde; işaret ters
  const ih = interval(X, pw, g.warpCenter);
  const fF = step(ih.s);
  const dsF = dStep(ih.s) / (g.warpCenter(ih.k0 + 1) - g.warpCenter(ih.k0));
  const j0 = Math.floor(Y / pf);
  const bestWarpH = best.axis === 1 ? best.h : -1e3;
  for (const j of [j0 - 1, j0, j0 + 1]) {
    const rf = g.weftRadius(j);
    const k = flattening(2 * rf, pf, g.flattenFactor);
    const { a, b } = ellipseAxes(rf, k);
    const dy = Y - g.weftCenter(j);
    if (!(Math.abs(dy) < a)) continue;
    const amp = (rwN + rf) * (1 - beta);
    const q0 = g.warpUp(ih.k0, j) ? -1 : 1;
    const q1 = g.warpUp(ih.k0 + 1, j) ? -1 : 1;
    const u = dy / a;
    const h = (q0 * (1 - fF) + q1 * fF) * amp + prof * b * Math.sqrt(Math.max(0, 1 - u * u));
    // Eşitlikte çözgü üstte kalır (referans: Hw >= Hf)
    if (h > best.h && h > bestWarpH) {
      best = { h, axis: 2, index: j, v: u, a, grad: [(q1 - q0) * amp * dsF, slope(u, a, b, prof)] };
    }
  }

  if (best.h <= g.bgHeight + 1e-6) return { height: g.bgHeight, axis: 0, index: 0, id: 0, v: 0, a: 0, grad: [0, 0] };
  const id = best.axis === 1 ? best.index + 1 : -(best.index + 1);
  return { height: best.h, axis: best.axis, index: best.index, id, v: best.v, a: best.a, grad: best.grad };
}

/**
 * FabricInput → geometri parametreleri (shader uniform'larıyla aynı değerler).
 * irregularityMul: Tuning.irregularity (0 = düzensizlik kapalı).
 */
export function geometryParamsFromInput(
  input: FabricInput,
  flattenFactor = 1,
  irregularityMul = 1,
  model: GeometryModel = 'classic',
  spreadMul = 1,
  packing?: PackingOverrides,
): GeometryParams {
  const radiusOfType = input.yarnTypes.map((y) => diameterMm(toTex(y.count, y.unit), y.yarnDensity ?? DEFAULT_YARN_DENSITY) / 2);
  const warpR = input.warp.map((t) => radiusOfType[t.yarnType]);
  const weftR = input.weft.map((t) => radiusOfType[t.yarnType]);
  const { warps, wefts, data } = input.weave;
  const ir = resolveIrregularity(input, irregularityMul);
  const pw = pitchMm(input.density.warpPerCm);
  const pf = pitchMm(input.density.weftPerCm);
  const base: GeometryParams = {
    warpUp: (i, j) => data[pmod(j, wefts) * warps + pmod(i, warps)] === 1,
    warpRadius: (i) => warpR[pmod(i, warpR.length)] * thicknessScale(0, i, ir),
    weftRadius: (j) => weftR[pmod(j, weftR.length)] * thicknessScale(1, j, ir),
    warpCenter: (i) => (i + 0.5) * pw + positionOffset(0, i, pw, ir),
    weftCenter: (j) => (j + 0.5) * pf + positionOffset(1, j, pf, ir),
    pitchWarp: pw,
    pitchWeft: pf,
    crimpShare: input.crimpShare ?? DEFAULT_CRIMP_SHARE,
    flattenFactor,
    model,
    bgHeight: -(Math.max(...warpR) + Math.max(...weftR)) * (1 + ir.thickness) * 1.4,
  };
  if (model !== 'v2') return base;
  // Paketleme (packing.ts / layout.ts): döşeme periyodunda merkez kayması (tarak / çekme) ve kesit en/boyu —
  // GPU iplik tablosuyla (pack.ts threadTable) aynı
  const tile = tileFor(input);
  const [lw, lf] = [0, 1].map((ax) => axisLayout(input, ax as 0 | 1, tile.threads[ax], packing, spreadMul));
  const [Pw, Pf] = tile.threads;
  const beta = input.crimpShare ?? V2_CRIMP_SHARE;
  return {
    ...base,
    warpCenter: (i) => (i + 0.5) * pw + lw.offset[pmod(i, Pw)] + positionOffset(0, pmod(i, Pw), pw, ir),
    weftCenter: (j) => (j + 0.5) * pf + lf.offset[pmod(j, Pf)] + positionOffset(1, pmod(j, Pf), pf, ir),
    crimpShare: beta,
    warpFlat: (i) => lw.aspect[pmod(i, Pw)],
    weftFlat: (j) => lf.aspect[pmod(j, Pf)],
    span: [layoutSpan(lw, ir.thickness, ir.position), layoutSpan(lf, ir.thickness, ir.position)],
    weaveSize: [warps, wefts],
    bgHeight: v2BgHeight(Math.max(...warpR, ...weftR) * (1 + ir.thickness), beta),
  };
}
