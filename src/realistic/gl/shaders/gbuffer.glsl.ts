/**
 * Geometri geçişi (G-buffer). CPU ikizi: realistic/geometry.ts `geometryAt` (taban) + relief.ts (rölyef).
 *
 * İki parametre seti (uModel):
 *   0 classic: Faz 2 modeli (0.6·b profil, basıklık, smoothstep krepaj D·β) — CPU heightfield tutarlılığı.
 *   1 v2 (fix-v2, reference/realistic-v2/prototip_render_v2.py): tam elips, cosine krepaj (0.45·r_w /
 *     0.40·r_w), iplik boyunca kalınlık ve yol dalgalanması, yükseklikte kat (ply) rölyefi + ince lifler +
 *     anizotropik lif gürültüsü. Üstteki iplik rölyef dahil yüksekliğe göre seçilir (prototip Hw >= Hf).
 *
 * Çıkışlar (MRT):
 *   gb0 (RGBA32F/16F) = (yükseklik mm, iplik boyu konumu mm mod 16, v = kesit içi −1..1, iplik indeksi i / j)
 *   gb1 (RGBA32F/16F) = (taban normal.x, normal.y, sistem 0 zemin / 1 çözgü / 2 atkı, kesit yarı genişliği a mm)
 *   gb2 (RGBA16F, mip'li) = (kat profili 0..1, ince lif −1..1, lif gürültüsü, yükseklik / r_ref)
 *     .w AO'da mip zinciriyle kutu ortalaması için (prototip uniform_filter).
 *   Sistem ayrı kanalda: indeks negatif olabilir (orijinin solu / altı), işaretle kodlanamaz.
 *
 * Döşeme periyodikliği (adım 2, tile.ts): iplik başına rastgele değerler indeks mod uPeriod ile; iplik
 * boyunca frekanslar (kat, ince lif, kalınlık / yol, lif dokusu) döşeme uzunluğuna yuvarlanır. Böylece
 * gölge / AO / tüy döşemesi kesintisiz tekrar eder ve ekran geometrisiyle birebir örtüşür.
 */
import { COMMON_GLSL } from './flat.glsl';
import { NOISE_GLSL } from './lit.glsl';

export const GBUFFER_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;

uniform usampler2D uWeave;
uniform usampler2D uWarpType;
uniform usampler2D uWeftType;
uniform sampler2D uYarnTypes;   // RGBA32F: (çap mm, ±büküm tur/mm (S −, Z +), parlaklık, tüy)
uniform sampler2D uFiber;       // R16F, tekrar eden anizotropik lif gürültüsü (x enine, y boyunca)
uniform ivec2 uWeaveSize;
uniform int uWarpCount;
uniform int uWeftCount;
uniform vec2 uPitchMm;
uniform vec2 uOffsetMm;
uniform float uPxPerMm;
uniform float uCrimpShare;      // β (classic)
uniform float uFlatten;         // basıklık çarpanı (classic; 0 = daire)
uniform float uBgHeight;        // −(max r_çözgü + max r_atkı)·(1 + kalınlık)·1.4
uniform uint uSeed;             // Faz 4 düzensizlik tohumu
uniform float uThick;           // kalınlık oranı (0.04 = ±%4)
uniform float uPos;             // konum kayması (aralık oranı)
uniform int uModel;             // 0 classic, 1 v2
uniform float uRelief;          // v2 rölyef çarpanı (0 = yalnız taban geometri)
uniform float uAlongMul;        // v2 iplik boyunca kalınlık / yol dalgalanması çarpanı (Tuning.irregularity)
uniform float uRRef;            // gb2.w normalizasyonu: ortalama çözgü yarıçapı (mm)
uniform float uFiberTexelsPerD; // lif dokusu: 1 çap = bu kadar texel
uniform float uFiberSize;       // lif dokusu kenarı (texel)
uniform ivec2 uPeriod;          // döşeme (çözgü, atkı) iplik sayısı
uniform vec2 uTileMm;           // döşeme boyu (mm)
uniform vec2 uPxPerMmXY;        // px / mm (x, y) — pişirmede döşemeye tam oturması için ayrı

layout(location = 0) out vec4 gb0;
layout(location = 1) out vec4 gb1;
layout(location = 2) out vec4 gb2;
${COMMON_GLSL}
${NOISE_GLSL}
const float PI = 3.14159265;
float threadRand(int axis, int idx, int ch) {
  int per = axis == 0 ? uPeriod.x : uPeriod.y;
  return hash01(ivec2(pmod(idx, per), axis * 16 + ch), uSeed) * 2.0 - 1.0;
}
// Döşemeye tam periyot (tile.ts snapFreq / snapPeriod)
float snapF(float f, float L) { return 6.2831853 * max(1.0, floor(f * L / 6.2831853 + 0.5)) / L; }
float snapP(float per, float L) { return L / max(1.0, floor(L / per + 0.5)); }
bool warpUp(int i, int j) {
  return texelFetch(uWeave, ivec2(pmod(i, uWeaveSize.x), pmod(j, uWeaveSize.y)), 0).r == 1u;
}
vec4 warpYarn(int i) { return texelFetch(uYarnTypes, ivec2(int(texelFetch(uWarpType, ivec2(pmod(i, uWarpCount), 0), 0).r), 0), 0); }
vec4 weftYarn(int j) { return texelFetch(uYarnTypes, ivec2(int(texelFetch(uWeftType, ivec2(pmod(j, uWeftCount), 0), 0).r), 0), 0); }
float warpR(int i) { return 0.5 * warpYarn(i).x * (1.0 + uThick * threadRand(0, i, 0)); }
float weftR(int j) { return 0.5 * weftYarn(j).x * (1.0 + uThick * threadRand(1, j, 0)); }
float warpC(int i) { return (float(i) + 0.5) * uPitchMm.x + uPos * uPitchMm.x * threadRand(0, i, 1); }
float weftC(int j) { return (float(j) + 0.5) * uPitchMm.y + uPos * uPitchMm.y * threadRand(1, j, 1); }
// VARSAYIM: k = 1 + 1.2·max(0, d/p − 0.6) ∈ [1, 2.2] (geometry.ts ile aynı)
float flattening(float d, float p) {
  return clamp(1.0 + uFlatten * 1.2 * max(0.0, d / p - 0.6), 1.0, 2.2);
}
float ss(float t) { float x = clamp(t, 0.0, 1.0); return x * x * (3.0 - 2.0 * x); }
float cs(float t) { float x = clamp(t, 0.0, 1.0); return 0.5 - 0.5 * cos(PI * x); }
float stepF(float t) { return uModel == 1 ? cs(t) : ss(t); }
float stepD(float t) { return uModel == 1 ? 0.5 * PI * sin(PI * t) : 6.0 * t * (1.0 - t); }
float slope(float u, float a, float b, float sc) { return -sc * b * u / (a * sqrt(max(1.0 - u * u, 0.0025))); }

// v2: iplik boyunca kalınlık (relief.ts thicknessAlong) ve yol sapması (relief.ts wobble), s = çapraz aralık birimi
// s: çapraz aralık birimi; L: döşemenin o eksendeki çapraz iplik sayısı
float alongThick(int ax, int idx, float s) {
  if (uModel != 1 || uAlongMul <= 0.0) return 1.0;
  float L = float(ax == 0 ? uPeriod.y : uPeriod.x);
  float A = (ax == 0 ? 0.06 : 0.07) * uAlongMul;
  return 1.0 + A * sin(snapF(0.45, L) * s + PI * threadRand(ax, idx, 5)) * sin(snapF(0.13, L) * s + PI * threadRand(ax, idx, 6));
}
float wobbleOf(int ax, int idx, float s) {
  if (uModel != 1 || uAlongMul <= 0.0) return 0.0;
  float L = float(ax == 0 ? uPeriod.y : uPeriod.x);
  float A = 0.025 * 1.7320508 * uAlongMul;
  if (ax == 0) return A * threadRand(0, idx, 7) * sin(snapF(0.9, L) * s + PI * threadRand(0, idx, 9)) + A * threadRand(0, idx, 8) * sin(snapF(0.31, L) * s + 3.0);
  return 0.03 * 1.7320508 * uAlongMul * threadRand(1, idx, 7) * sin(snapF(0.7, L) * s + PI * threadRand(1, idx, 9));
}
float bandLimit(float periodPx) { return clamp((periodPx - 2.0) * 0.5, 0.0, 1.0); }

// v2 rölyef terimleri (relief.ts ile aynı). s = eksen boyunca mm, u = kesit içi −1..1, cross = enine mm (Z yönü işaretli)
// Dönüş: (kat profili, ince lif, lif gürültüsü)
vec3 reliefTerms(int ax, int idx, vec4 yt, float s, float u, float cross) {
  float d = yt.x;
  float T = abs(yt.y);
  float sgn = yt.y < 0.0 ? -1.0 : 1.0;
  // Kat aralığı = 1.1·d·(0.7 tur/mm / T) — VARSAYIM k = 1.1, T₀ = 700 tur/m (kullanıcı kararı)
  float Ls = ax == 0 ? uTileMm.y : uTileMm.x;               // döşemenin iplik boyunca uzunluğu
  float spacing = T > 1e-5 ? snapP(1.1 * d * (0.7 / T), Ls) : 1e6;
  float phase = PI * s / spacing - sgn * asin(clamp(u, -1.0, 1.0));
  float ply = pow(abs(sin(phase)), 0.6);
  ply = mix(0.76, ply, bandLimit(spacing * uPxPerMm)); // uzakta ortalamaya söner (|sin|^0.6 ortalaması ≈ 0.76)
  // İnce lif şeritleri: ters (S) yön, periyot 0.1·d, eğim 0.6 — VARSAYIM
  float per = snapP(0.1 * d, Ls);
  float fibl = sin(2.0 * PI * (s - sgn * 0.6 * cross) / per) * bandLimit(0.86 * per * uPxPerMm);
  // Lif gürültüsü: iplik çerçevesinde (enine, boyunca) örnekleme; iplik başına rastgele doku ötelemesi
  float tpm = uFiberTexelsPerD / d;                         // texel / mm
  // boyunca: döşeme uzunluğu dokunun tam katı olsun
  float tAlong = max(1.0, floor(Ls * tpm / uFiberSize + 0.5)) / Ls;   // doku tekrarı / mm
  vec2 tc = vec2(cross * tpm / uFiberSize, s * tAlong) + 0.5 * vec2(threadRand(ax, idx, 10), threadRand(ax, idx, 11));
  float lod = max(0.0, log2(tpm / uPxPerMm));
  float fib = textureLod(uFiber, tc, lod).r;
  return vec3(ply, fibl, fib);
}

int nearestWarp(float x) {
  int i = int(floor(x / uPitchMm.x));
  int best = i; float bd = abs(x - warpC(i));
  float d0 = abs(x - warpC(i - 1)); if (d0 < bd) { bd = d0; best = i - 1; }
  float d1 = abs(x - warpC(i + 1)); if (d1 < bd) { bd = d1; best = i + 1; }
  return best;
}
int nearestWeft(float y) {
  int j = int(floor(y / uPitchMm.y));
  int best = j; float bd = abs(y - weftC(j));
  float d0 = abs(y - weftC(j - 1)); if (d0 < bd) { bd = d0; best = j - 1; }
  float d1 = abs(y - weftC(j + 1)); if (d1 < bd) { bd = d1; best = j + 1; }
  return best;
}

void main() {
  vec2 mm = uOffsetMm + (gl_FragCoord.xy - 0.5) / uPxPerMmXY;
  float X = mm.x;
  float Y = mm.y;
  float pw = uPitchMm.x;
  float pf = uPitchMm.y;
  bool v2 = uModel == 1;
  float beta = uCrimpShare;
  float prof = v2 ? 1.0 : 0.6;
  float relief = v2 ? uRelief : 0.0;
  int jN = nearestWeft(Y);
  int iN = nearestWarp(X);
  float rfN = weftR(jN);
  float rwN = warpR(iN);

  float bestH = -1e3; float bestAxis = 0.0; float bestIdx = 0.0; float bestV = 0.0; float bestA = 0.0; vec2 bestG = vec2(0.0);
  vec3 bestRel = vec3(0.76, 0.0, 0.0);

  // Çözgü adayları: atkı merkezleri arasında krepaj aralığı
  int k0 = int(floor(Y / pf - 0.5));
  if (Y < weftC(k0)) k0 -= 1; else if (Y >= weftC(k0 + 1)) k0 += 1;
  float c0 = weftC(k0); float c1 = weftC(k0 + 1);
  float s = clamp((Y - c0) / (c1 - c0), 0.0, 1.0);
  float f = stepF(s);
  float dsW = stepD(s) / (c1 - c0);
  int i0 = int(floor(X / pw));
  for (int di = -1; di <= 1; di++) {
    int i = i0 + di;
    float rw = warpR(i) * alongThick(0, i, Y / pf);
    float k = v2 ? 1.0 : flattening(2.0 * rw, pw);
    float a = rw * sqrt(k); float b = rw / sqrt(k);
    float dx = X - warpC(i) - wobbleOf(0, i, Y / pf) * pw;
    if (!(abs(dx) < a)) continue;
    float amp = v2 ? 0.45 * rw : (rw + rfN) * beta;
    float s0 = warpUp(i, k0) ? 1.0 : -1.0;
    float s1 = warpUp(i, k0 + 1) ? 1.0 : -1.0;
    float u = dx / a;
    float profH = prof * b * sqrt(max(0.0, 1.0 - u * u));
    vec3 rel = vec3(0.76, 0.0, 0.0);
    float rf = 1.0;
    if (relief > 0.0) {
      rel = reliefTerms(0, i, warpYarn(i), Y, u, dx);
      rf = 1.0 + relief * (0.82 + 0.18 * rel.x + 0.02 * rel.y + 0.03 * rel.z - 1.0);
    }
    float h = (s0 * (1.0 - f) + s1 * f) * amp + profH * rf;
    if (h > bestH) { bestH = h; bestAxis = 1.0; bestIdx = float(i); bestV = u; bestA = a; bestRel = rel; bestG = vec2(slope(u, a, b, prof), (s1 - s0) * amp * dsW); }
  }
  float bestWarpH = bestAxis == 1.0 ? bestH : -1e3;

  // Atkı adayları (işaret ters); eşitlikte çözgü üstte kalır
  int k2 = int(floor(X / pw - 0.5));
  if (X < warpC(k2)) k2 -= 1; else if (X >= warpC(k2 + 1)) k2 += 1;
  float e0 = warpC(k2); float e1 = warpC(k2 + 1);
  float s2 = clamp((X - e0) / (e1 - e0), 0.0, 1.0);
  float f2 = stepF(s2);
  float dsF = stepD(s2) / (e1 - e0);
  int j0 = int(floor(Y / pf));
  for (int dj = -1; dj <= 1; dj++) {
    int j = j0 + dj;
    float rf0 = weftR(j) * alongThick(1, j, X / pw);
    float k = v2 ? 1.0 : flattening(2.0 * rf0, pf);
    float a = rf0 * sqrt(k); float b = rf0 / sqrt(k);
    float dy = Y - weftC(j) - wobbleOf(1, j, X / pw) * pf;
    if (!(abs(dy) < a)) continue;
    float amp = v2 ? 0.40 * rwN : (rwN + rf0) * (1.0 - beta);
    float q0 = warpUp(k2, j) ? -1.0 : 1.0;
    float q1 = warpUp(k2 + 1, j) ? -1.0 : 1.0;
    float u = dy / a;
    float profH = prof * b * sqrt(max(0.0, 1.0 - u * u));
    vec3 rel = vec3(0.76, 0.0, 0.0);
    float rfac = 1.0;
    if (relief > 0.0) {
      // Atkıda enine eksen −y: Z oluklar ekranda "\" (relief.ts plyPhase)
      rel = reliefTerms(1, j, weftYarn(j), X, -u, -dy);
      rfac = 1.0 + relief * (0.82 + 0.18 * rel.x + 0.02 * rel.y + 0.03 * rel.z - 1.0);
    }
    float h = (q0 * (1.0 - f2) + q1 * f2) * amp + profH * rfac;
    if (h > bestH && h > bestWarpH) { bestH = h; bestAxis = 2.0; bestIdx = float(j); bestV = u; bestA = a; bestRel = rel; bestG = vec2((q1 - q0) * amp * dsF, slope(u, a, b, prof)); }
  }

  if (bestH <= uBgHeight + 1e-6) {
    gb0 = vec4(uBgHeight, 0.0, 0.0, 0.0);
    gb1 = vec4(0.0, 0.0, 0.0, 0.0);
    // Boşluk AO yüksekliği: prototip −2.2 (çözgü yarıçapı birimi)
    gb2 = vec4(0.0, 0.0, 0.0, max(uBgHeight / uRRef, -2.2));
    return;
  }
  vec3 n = normalize(vec3(-bestG, 1.0));
  gb0 = vec4(bestH, mod(bestAxis == 1.0 ? Y : X, 16.0), bestV, bestIdx);
  gb1 = vec4(n.xy, bestAxis, bestA);
  gb2 = vec4(bestRel, max(bestH / uRRef, -2.2));
}
`;

/**
 * Faz 2 önizleme: G-buffer'ı göstermek için basit Lambert (sRGB'de, düzeltmesiz). Faz 3'te
 * doğrusal uzayda gerçek ışık modeli bunun yerini alır.
 */
export const PREVIEW_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uGb0;
uniform sampler2D uGb1;
uniform sampler2D uWarpColor;
uniform sampler2D uWeftColor;
uniform int uWarpCount;
uniform int uWeftCount;
uniform vec3 uLightDir;
uniform float uBgHeight;
uniform float uHeightRange;

out vec4 outColor;
${COMMON_GLSL}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 g0 = texelFetch(uGb0, p, 0);
  vec4 g1 = texelFetch(uGb1, p, 0);
  if (g1.z < 0.5) { outColor = vec4(0.043, 0.047, 0.059, 1.0); return; }
  int idx = int(round(g0.w));
  vec3 base = g1.z < 1.5
    ? texelFetch(uWarpColor, ivec2(pmod(idx, uWarpCount), 0), 0).rgb
    : texelFetch(uWeftColor, ivec2(pmod(idx, uWeftCount), 0), 0).rgb;
  vec3 n = vec3(g1.xy, sqrt(max(0.0, 1.0 - dot(g1.xy, g1.xy))));
  float lambert = max(dot(n, uLightDir), 0.0);
  float depth = clamp((g0.x - uBgHeight) / uHeightRange, 0.0, 1.0); // alçak yer biraz koyu
  outColor = vec4(base * (0.25 + 0.75 * lambert) * (0.55 + 0.45 * depth), 1.0);
}
`;
