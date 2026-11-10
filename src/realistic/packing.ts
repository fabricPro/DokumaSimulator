/**
 * Temas tabanlı paketleme (saf, testli): her iplik kesiti, komşu ipliğe ya da kendisine ayrılan alanın (hücre)
 * sınırına değene kadar yassılaşıp genişler; kesit alanı (hacim) korunur, yükseklik buna göre azalır.
 * Gerçekçi render (pack.ts threadTable, geometry.ts CPU ikizi) ve metriklerdeki açıklık / örtme bu modelden gelir
 * (tek model; eski Peirce "yuvarlak iplik" değeri yalnız teorik bilgi olarak gösterilir).
 *
 * Hücre: iplik merkezinin iki yanında komşu merkezle orta nokta. Komşu bir BOŞ DİŞİN öbür yanındaysa (tarak) o
 * yandaki sınır ipliğin kendi dişinin kenarıdır (`limitL/limitR`): boş diş şeridi açık kalır (yalancı lino etkisi).
 *
 * Kesit genişliği w (d = yuvarlak çap, hücre H = sol + sağ):
 *   w = min(d·√maxAspect, max(fill·H, min(d, H)))       — yayılma: tip üst sınırı ve doldurma oranıyla
 *   w = max(w, compression·d)                            — sıkışma: hücre çaptan darsa en fazla bu kadar daralır
 * Elips yarı eksenleri a = w/2, b = d²/(4·a) (πab = πd²/4 korunur); en/boy A = (w/d)².
 * w > H ise taşan kısım `overlap` (dişe sığmayan teller: hafif bindirme olarak çizilir).
 * Merkez hücre içinde kalacak şekilde kaydırılır (asimetrik hücre: boş diş yanındaki iplik dişin içine itilir).
 * Seyrek dokuda w hücreyi aşmaz → boşluk doğal olarak açık kalır; alan sınırı aşılmaz.
 *
 * VARSAYIM (kalibre edilecek; kalibrasyon ekranından değiştirilebilir, preset ile kaydedilir) — DEFAULT_PACKING.
 */

export type PackKind = 'filament' | 'textured' | 'spunSingle' | 'spunPlied' | 'tape';
export const PACK_KINDS: PackKind[] = ['filament', 'textured', 'spunSingle', 'spunPlied', 'tape'];
export const PACK_KIND_LABEL: Record<PackKind, string> = {
  filament: 'Filament',
  textured: 'Tekstüre',
  spunSingle: 'Eğrilmiş tek kat',
  spunPlied: 'Eğrilmiş çok kat',
  tape: 'Yassı bant',
};

export interface PackKindParams {
  /** En büyük en/boy oranı (w/b·…; A = (w/d)²). Yayılma kapasitesi: filament > tekstüre > tek kat > çok kat. */
  maxAspect: number;
  /** Doldurma oranı: kesit hücrenin en fazla bu kadarını doldurur (0..1). */
  fill: number;
}

export interface PackingParams {
  kinds: Record<PackKind, PackKindParams>;
  /** Sıkışma katsayısı: hücre çaptan darken genişlik en az compression·d (DEFAULT_RELAX.c racetrack ile aynı 0.85). */
  compression: number;
}

/**
 * VARSAYIM (kalibre edilecek): Bendix v3 ve bantlı çözgü lup görünümü eski CPU heightfield'ın kapalılığına yakın
 * olacak şekilde seçildi (samples/realistic/packing/sonra-packing.json).
 */
export const DEFAULT_PACKING: PackingParams = {
  kinds: {
    filament: { maxAspect: 3.0, fill: 0.98 },
    textured: { maxAspect: 2.4, fill: 0.95 },
    spunSingle: { maxAspect: 1.8, fill: 0.92 },
    spunPlied: { maxAspect: 1.5, fill: 0.88 },
    tape: { maxAspect: 3.0, fill: 1.0 },
  },
  compression: 0.85,
};

export type PackingOverrides = { kinds?: Partial<Record<PackKind, Partial<PackKindParams>>>; compression?: number };

export function resolvePacking(p?: PackingOverrides): PackingParams {
  const kinds = {} as Record<PackKind, PackKindParams>;
  for (const k of PACK_KINDS) kinds[k] = { ...DEFAULT_PACKING.kinds[k], ...(p?.kinds?.[k] ?? {}) };
  return { kinds, compression: p?.compression ?? DEFAULT_PACKING.compression };
}

/** Önbellek anahtarı için kısa metin. */
export function packingKey(p: PackingParams): string {
  return PACK_KINDS.map((k) => `${p.kinds[k].maxAspect},${p.kinds[k].fill}`).join(';') + `;${p.compression}`;
}

/** İplik yapısı + kat sayısı → paketleme tipi. Yapı yoksa eğrilmiş (kat 2 varsayılan, YarnType ile aynı). */
export function packKind(structure?: string, plies = 2): PackKind {
  if (structure === 'filament' || structure === 'textured' || structure === 'tape') return structure;
  return plies > 1 ? 'spunPlied' : 'spunSingle';
}

export interface PackedSection {
  /** Kesit tam genişliği w (mm). */
  width: number;
  /** Kesit tam yüksekliği 2b (mm). */
  height: number;
  /** En/boy A = (w/d)² (shader: a = r·√A, b = r/√A). */
  aspect: number;
  /** Hücreyi aşan genişlik (mm, ≥ 0). */
  overlap: number;
}

/**
 * Tek kesit. `spread`: Tuning.spread (0 = sert yuvarlak kesit, 1 = model). Yarı yolda doğrusal karışım.
 */
export function packSection(d: number, cellW: number, kind: PackKind, params: PackingParams, spread = 1): PackedSection {
  const kp = params.kinds[kind];
  const H = Math.max(0, cellW);
  let w = Math.min(d * Math.sqrt(Math.max(1, kp.maxAspect)), Math.max(kp.fill * H, Math.min(d, H)));
  w = Math.max(w, Math.min(1, Math.max(0.05, params.compression)) * d);
  const s = Math.max(0, Math.min(1, spread));
  w = d + (w - d) * s;
  const aspect = (w / d) ** 2;
  return { width: w, height: (d * d) / w, aspect, overlap: Math.max(0, w - H) };
}

export interface AxisPackInput {
  /** Bir periyottaki iplik merkezleri (mm, artan; periyot dışına taşabilir). */
  centers: ArrayLike<number>;
  periodMm: number;
  /** Yuvarlak çaplar (mm), merkezlerle aynı uzunluk. */
  diameters: ArrayLike<number>;
  kinds: ArrayLike<PackKind>;
  /** Merkezden sol / sağ en fazla yayılma (mm; boş diş kenarı). Verilmezse sınırsız. */
  limitL?: ArrayLike<number>;
  limitR?: ArrayLike<number>;
}

export interface AxisPack {
  /** Hücre içine kaydırılmış merkezler (mm). */
  centers: Float64Array;
  width: Float64Array;
  aspect: Float64Array;
  /** Hücre sol / sağ yarı genişlikleri (merkezden; mm). */
  cellL: Float64Array;
  cellR: Float64Array;
  overlap: Float64Array;
  /** Açık (iplik görünmeyen) izdüşüm oranı 0..1. */
  clearFraction: number;
}

export function packAxis(inp: AxisPackInput, params: PackingParams, spread = 1): AxisPack {
  const P = inp.centers.length;
  const W = inp.periodMm;
  const c = (k: number) => {
    const q = Math.floor(k / P);
    return q * W + inp.centers[k - q * P];
  };
  const centers = new Float64Array(P);
  const width = new Float64Array(P);
  const aspect = new Float64Array(P);
  const cellL = new Float64Array(P);
  const cellR = new Float64Array(P);
  const overlap = new Float64Array(P);
  let clear = 0;
  for (let k = 0; k < P; k++) {
    const ck = c(k);
    let L = (ck - c(k - 1)) / 2;
    let R = (c(k + 1) - ck) / 2;
    if (inp.limitL) L = Math.min(L, inp.limitL[k]);
    if (inp.limitR) R = Math.min(R, inp.limitR[k]);
    L = Math.max(0, L);
    R = Math.max(0, R);
    const d = inp.diameters[k];
    const sec = packSection(d, L + R, inp.kinds[k], params, spread);
    let x = ck;
    if (sec.width <= L + R) x = Math.min(Math.max(ck, ck - L + sec.width / 2), ck + R - sec.width / 2);
    centers[k] = x;
    width[k] = sec.width;
    aspect[k] = sec.aspect;
    cellL[k] = L;
    cellR[k] = R;
    overlap[k] = sec.overlap;
    clear += Math.max(0, L + R - sec.width);
  }
  // Komşu hücreler arası kesintiler (boş diş: sınırlar orta noktadan önce kesildiyse) da açıktır
  let gaps = 0;
  for (let k = 0; k < P; k++) {
    const between = c(k + 1) - c(k) - cellR[k] - cellL[(k + 1) % P];
    if (between > 0) gaps += between;
  }
  return { centers, width, aspect, cellL, cellR, overlap, clearFraction: W > 0 ? Math.min(1, (clear + gaps) / W) : 0 };
}

/** İzdüşüm açıklığı (%) = çözgü açık oranı × atkı açık oranı; örtme = 100 − açıklık. */
export function packedOpenPct(warp: AxisPack, weft: AxisPack): number {
  return 100 * warp.clearFraction * weft.clearFraction;
}
