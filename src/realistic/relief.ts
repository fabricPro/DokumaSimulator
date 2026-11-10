/**
 * fix-v2 iplik yüzey rölyefi (saf; G-buffer shader'ındaki terimlerin CPU ikizleri).
 * Kaynak: reference/realistic-v2/prototip_render_v2.py. Prototip piksel birimlerinde çalışır; burada her
 * şey iplik çapı d (mm) cinsinden ifade edilir, ölçekten bağımsızdır.
 *
 * Yükseklik (prototip Hw/Hf): krepaj + r·profil·(0.82 + 0.18·kat + 0.02·ince lif + 0.03·lif gürültüsü).
 */
import { DEFAULT_TWIST_PER_M } from './pack';
import { diameterMm, toTex } from './yarn';

/**
 * Kat (ply) oluk aralığı, iplik ekseni boyunca (fix-v3, fiziksel + kalibrasyon):
 *   büküm açısı tan α = π·d·T (surface.ts twistAngle), bir turun adımı π·d / tan α (= 1/T),
 *   oluk aralığı = K · π·d / (kat · tan α) = K / (kat · T).
 * VARSAYIM (kullanıcı kararı, kalibre edilecek): K, bantlı fixture'da (Ne 20/1, d ≈ 0.21 mm, 700 tur/m, 2 kat)
 * fix-v2'nin hedefle eşlenen 1.1·d aralığını verecek şekilde sabit: K = 1.1·d_fix·2·0.7 ≈ 0.32. Saf fiziksel
 * sarmal (K = 1) aynı iplikte ≈3.4·d verir; hedef görüntüdeki sık oluğu üretmez.
 */
export const PLY_FIXTURE_D_MM = diameterMm(toTex(20, 'Ne'));
export const DEFAULT_PLIES = 2;
export const PLY_K = 1.1 * PLY_FIXTURE_D_MM * DEFAULT_PLIES * 0.7;
export function plySpacingMm(diameterMm: number, twistPerM: number = DEFAULT_TWIST_PER_M, plies = DEFAULT_PLIES): number {
  if (!(diameterMm > 0)) throw new Error('Çap pozitif olmalı.');
  if (!(twistPerM > 0)) return Infinity;
  const T = twistPerM / 1000;
  const tanA = Math.PI * diameterMm * T;
  return (PLY_K * Math.PI * diameterMm) / (Math.max(1, plies) * tanA);
}

/**
 * Oluk eğimi: kat sarmalı silindir üzerinde; bir turda (2 kat → eksen boyunca 2·aralık) çevre π·d.
 * Ön yüzde (kesit merkezi) eksen boyunca ilerleme / enine konum = 2·aralık / (π·d); kenara doğru
 * asin nedeniyle dikleşir (gerçek iplikteki kavisli oluklar). Prototipteki sabit eğim 0.85 ile uyumlu:
 * aralık 1.1·d → 0.70 (merkezde), kenarlara doğru artar.
 */
export function plyCentreSlope(diameterMm: number, spacingMm: number): number {
  return (2 * spacingMm) / (Math.PI * diameterMm);
}

/**
 * Kat fazı: π·s/aralık − yön·asin(v). s = iplik ekseni boyunca konum (mm), v = kesit içi −1..1,
 * yön: Z = +1, S = −1. Çözgüde (s = y, v sağa artar) Z oluklar "/"; atkıda v = −(y kesiti) ile "\".
 */
export function plyPhase(sMm: number, v: number, spacingMm: number, twistSign: 1 | -1): number {
  return (Math.PI * sMm) / spacingMm - twistSign * Math.asin(Math.max(-1, Math.min(1, v)));
}

/** Prototip ply_w: |sin|^0.6 — oluk (0) keskin, sırt (1) yuvarlak. */
export const PLY_EXPONENT = 0.6;
export function plyProfile(phase: number): number {
  return Math.pow(Math.abs(Math.sin(phase)), PLY_EXPONENT);
}

/**
 * Kat içindeki ince lif şeritleri (prototip fibl): ters yönde (S), periyot 0.1·d, eğim 0.6.
 * VARSAYIM: prototipte 0.09·çözgü aralığı ≈ 0.1·d (çap/aralık 0.87).
 */
export const FIBRE_LINE_PERIOD_D = 0.1;
export const FIBRE_LINE_TILT = 0.6;
export function fibreLines(sMm: number, crossMm: number, diameterMm: number, twistSign: 1 | -1): number {
  const period = FIBRE_LINE_PERIOD_D * diameterMm;
  return Math.sin((2 * Math.PI * (sMm - twistSign * FIBRE_LINE_TILT * crossMm)) / period);
}

/**
 * Analitik bant sınırlama: periyodu ekranda ~2 pikselin altına inen desen aliasing yapar. Genlik,
 * periyot 2 px'te 0, 4 px ve üstünde 1 olacak şekilde söner (prototip 2× süper örnekleme yapıyordu).
 */
export function bandLimit(periodPx: number): number {
  return Math.max(0, Math.min(1, (periodPx - 2) / 2));
}

/** Prototip rölyef payları (yarıçap çarpanı). VARSAYIM. */
export const RELIEF_BASE = 0.82;
export const RELIEF_PLY = 0.18;
export const RELIEF_FIBRE_LINES = 0.02;
export const RELIEF_FIBRE_NOISE = 0.03;
export function reliefFactor(ply: number, fibl: number, fib: number): number {
  return RELIEF_BASE + RELIEF_PLY * ply + RELIEF_FIBRE_LINES * fibl + RELIEF_FIBRE_NOISE * fib;
}

/**
 * İplik boyunca kalınlık dalgalanması (prototip thick_w / thick_f):
 * 1 + A·sin(0.45·s + φ₁)·sin(0.13·s + φ₂), s = eksen boyunca konum / çapraz iplik aralığı.
 * A: çözgü 0.06, atkı 0.07 (× Tuning.irregularity). φ'ler iplik başına tohumdan.
 */
export const ALONG_THICKNESS_WARP = 0.06;
export const ALONG_THICKNESS_WEFT = 0.07;
export function thicknessAlong(sPitch: number, phi1: number, phi2: number, amp: number): number {
  return 1 + amp * Math.sin(0.45 * sPitch + phi1) * Math.sin(0.13 * sPitch + phi2);
}

/**
 * Yol sapması (prototip u2 / v2), aralık oranı: a₁·sin(0.9·s + φ) + a₂·sin(0.31·s + 3).
 * Prototipte a ~ N(0, 0.025); burada eşit varyanslı düzgün dağılım: a = 0.025·√3·t, t ∈ [−1, 1].
 */
export const WOBBLE_STD = 0.025;
export function wobble(sPitch: number, t1: number, t2: number, phi: number): number {
  const A = WOBBLE_STD * Math.sqrt(3);
  return A * t1 * Math.sin(0.9 * sPitch + phi) + A * t2 * Math.sin(0.31 * sPitch + 3);
}
