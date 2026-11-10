/**
 * Geometri geçişi (G-buffer). CPU ikizi: realistic/geometry.ts `geometryAt` (taban) + relief.ts (rölyef).
 *
 * İki parametre seti (uModel):
 *   0 classic: Faz 2 modeli (0.6·b profil, basıklık, smoothstep krepaj D·β) — CPU heightfield tutarlılığı.
 *   1 v2 (fix-v3): TEMAS TABANLI yol — iplik merkezi kesişim z'lerinden (uCross, CPU geometry.ts crossingTable;
 *     z_w − z_f = b_w + b_f) cosine geçişle geçer; tam elips kesit (sıkışma basıklığı ≤ 1.4, bant 3);
 *     iplik boyunca kalınlık ve yol dalgalanması. KATMANLI: adaylar (her sistemde noktayı çevreleyen 2 merkez;
 *     çok kalın iplikte 4) taban yüksekliğiyle sıralanır, en üst iki
 *     katman tutulur (alt katman boşlukta / kenarda görünür kalır); rölyef (kat, ince lif, lif) yalnız üstte.
 *     Kenar yumuşatma: fwidth ayak iziyle analitik kapsama (silüet × kesişim çizgisi).
 *
 * Çıkışlar (MRT):
 *   gb0 (RGBA32F/16F) = (yükseklik mm, iplik boyu konumu mm mod 16, v = kesit içi −1..1, iplik indeksi i / j)
 *   gb1 (RGBA32F/16F) = (normal.x, normal.y (v2: boyunca eğim + kat bombesi; classic: tam taban), sistem 0 zemin / 1 çözgü / 2 atkı, üst kapsama 0..1)
 *   gb2 (RGBA16F, mip'li) = (kat profili 0..1, ince lif −1..1, lif gürültüsü, yükseklik / r_ref)
 *     .w AO'da mip zinciriyle kutu ortalaması için (prototip uniform_filter).
 *   gb3 (RGBA16F) = alt katman (indeks, sistem + 0.9·kenar kapsaması, taban normal.x, normal.y); sistem 0 = zemin.
 *   Sistem ayrı kanalda: indeks negatif olabilir (orijinin solu / altı), işaretle kodlanamaz.
 *
 * Döşeme periyodikliği (adım 2, tile.ts): iplik başına rastgele değerler indeks mod uPeriod ile; iplik
 * boyunca frekanslar (kat, ince lif, kalınlık / yol, lif dokusu) döşeme uzunluğuna yuvarlanır. Böylece
 * gölge / AO / tüy döşemesi kesintisiz tekrar eder ve ekran geometrisiyle birebir örtüşür.
 */
import { COMMON_GLSL, FABRIC_WARP_GLSL } from './flat.glsl';
import { NOISE_GLSL } from './lit.glsl';

export const GBUFFER_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;

uniform usampler2D uWeave;
uniform usampler2D uWarpType;
uniform usampler2D uWeftType;
uniform sampler2D uYarnTypes;   // RGBA32F, 2 satır: (çap mm, ±büküm tur/mm (S −, Z +), parlaklık, tüy) / (kat, bant, 0, 0)
uniform sampler2D uCross;       // RGBA32F, döşeme periyodu: kesişim (z_çözgü, z_atkı mm, çözgü flotte, atkı flotte) (v2)
uniform int uLayered;           // 1: katmanlı çizim + kenar yumuşatma (varsayılan), 0: tek katman (ölçüm)
uniform float uPlyK;            // relief.ts PLY_K
uniform sampler2D uThreads;     // RGBA32F iplik tablosu (pack.ts threadTable), v2
uniform vec4 uFreqW;            // çözgü boyunca döşemeye yuvarlanmış frekanslar (0.45, 0.13, 0.9, 0.31) — tile.ts snapFreq
uniform vec3 uFreqF;            // atkı boyunca (0.45, 0.13, 0.7)
uniform float uSoftEdge;        // yumuşak iplik kenarı (kesit yarı genişliği oranı): kenarda lif dolgusu
uniform float uDetailMm;        // Göz / Uzak: algısal filtre çapı (mm); periyodu < 2·çap iplik içi detay söner (0 = Lup)
uniform int uSpan;              // aday yarı genişliği: 1 → iki komşu merkez; 2 → dört (kesit genişliği > aralık)
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
layout(location = 3) out vec4 gb3;
${COMMON_GLSL}
${FABRIC_WARP_GLSL}
${NOISE_GLSL}
const float PI = 3.14159265;
// Kat bombesinin yükseklik payı (iplik profilinin oranı): h += prof·PLY_H·(ply − 0.76). VARSAYIM (kalibre edilecek)
const float PLY_H = 0.26;
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
float slope(float u, float a, float b, float sc) { return -sc * b * u / (a * sqrt(max(1.0 - u * u, 0.0025))); }

float bandLimit(float periodPx) { return clamp((periodPx - 2.0) * 0.5, 0.0, 1.0); }

// v2 rölyef terimleri. s = eksen boyunca mm, u = kesit içi −1..1, cross = enine mm (Z yönü işaretli), a = kesit yarı
// genişliği mm, fp = piksel ayak izi mm.
// Dönüş: (kat profili, ince lif, lif gürültüsü). fix-v4: ince lif şeritleri (diyagonal sinüs) gri ipliklerde kafes /
// denim moiré'si yaptığı için eğrilmiş iplikte 0 (yalnız bantta filament çizgisi); kat profili albedoya değil
// yüksekliğe girer, gradyanı dPly (d/boyunca, d/enine; band sınırlamalı) analitik verilir → kat kendi bombesini
// ve oluk gölgesini normalden alır. Lif gürültüsü anizotropik (textureGrad, ayak izinden) ve ayak izi lif
// detayından büyükse söner.
// t0 / t2 / t3: iplik tablosu satırları (pack.ts threadTable)
vec3 reliefTerms(int ax, vec4 t0, vec4 t2, vec4 t3, float s, float u, float cross, float a, vec2 fp, out vec2 dPly) {
  // Bakış modunda göz bu mesafede iplik içi detayı (kat / büküm şeridi, lif) çözemez: bant sınırlama ve lif sönümü
  // piksel yerine algısal çapa göre (periyot < 2·çap → 0). Lup'ta uDetailMm = 0 → piksel.
  float pxd = uDetailMm > 0.0 ? min(uPxPerMm, 2.0 / uDetailMm) : uPxPerMm;
  fp = max(fp, vec2(0.5 * uDetailMm));
  float d = t0.w;
  float T = abs(t3.x);
  float sgn = t3.x < 0.0 ? -1.0 : 1.0;
  // Yapı (pack.ts STRUCTURE_CODE): 0 eğrilmiş, 1 bant, 2 filament, 3 tekstüre
  bool spun = t3.z < 0.5;
  bool tape = t3.z > 0.5 && t3.z < 1.5;
  bool textured = t3.z > 2.5;
  float Ls = ax == 0 ? uTileMm.y : uTileMm.x;               // döşemenin iplik boyunca uzunluğu
  // Kat aralığı = K·π·d / (kat·tan α), tan α = π·d·T (relief.ts plySpacingMm; K kalibrasyon)
  float tanA = 3.14159265 * d * T;
  float spacing = (T > 1e-5 && spun) ? snapP(uPlyK * 3.14159265 * d / (max(1.0, t3.y) * tanA), Ls) : 1e6;
  float phase = PI * s / spacing - sgn * asin(clamp(u, -1.0, 1.0));
  float sp = sin(phase);
  float bl = bandLimit(spacing * pxd);
  float ply = mix(0.76, pow(abs(sp), 0.6), bl);  // uzakta ortalamaya söner (|sin|^0.6 ortalaması ≈ 0.76)
  // d ply / d φ (oluk tepesinde tekil: |sin| >= 0.12 ile sınırlı), φ'nin boyunca / enine türevi
  float dpd = 0.6 * pow(max(abs(sp), 0.12), -0.4) * cos(phase) * (sp < 0.0 ? -1.0 : 1.0) * bl;
  float cu = 1.0 / (a * max(sqrt(max(1.0 - u * u, 0.0)), 0.2));
  dPly = dpd * vec2(PI / spacing, -sgn * cu);
  float fibl = 0.0;
  bool single = spun && t3.y < 1.5;
  // Tek katlı eğrilmiş: kat oluğu YOK. Yüzey lifleri büküm açısında sarmal (tan α = π·d·T; Z büküm "/", S "\\"):
  // lif demetleri α açısında ince şerit (kabartma) ve sarmal yönünde uzamış lif dokusu. arc: kesit üzerinde yay boyu.
  float tanH = max(tanA, 0.05);
  float caH = inversesqrt(1.0 + tanH * tanH);
  float saH = tanH * caH;
  float arc = a * asin(clamp(u, -1.0, 1.0));
  float nH = s * caH - sgn * arc * saH;   // liflere dik
  float tH = s * saH + sgn * arc * caH;   // lif boyunca
  if (single) {
    // VARSAYIM: lif demeti şeridi periyodu 0.22·d, kabartma payı ±0.10 (kat oluğunun ~yarısı, oluk tepesi yok)
    float perH = 0.22 * d;
    float blH = bandLimit(perH * pxd);
    float ph = 2.0 * PI * nH / perH;
    ply = 0.76 + 0.10 * sin(ph) * blH;
    dPly = 0.10 * cos(ph) * blH * (2.0 * PI / perH) * vec2(caH, -sgn * saH * a * cu);
  } else if (!spun) {
    // Bant / filament / tekstüre: büküm görünmez
    ply = 0.76;
    dPly = vec2(0.0);
    // Bant ve filament: eksene paralel ince filament çizgileri (tekstürede yok)
    if (!textured) fibl = sin(2.0 * PI * cross / (0.06 * d)) * bandLimit(0.06 * d * pxd);
  }
  // Lif gürültüsü: iplik çerçevesinde (enine, boyunca) çapa normalize örnekleme; iplik başına doku ötelemesi
  float tpm = uFiberTexelsPerD / d;                         // texel / mm
  float tAlong = max(1.0, floor(Ls * tpm / uFiberSize + 0.5)) / Ls;   // doku tekrarı / mm
  vec2 tc = vec2(cross * tpm / uFiberSize, s * tAlong) + 0.5 * t2.yz;
  // Ekran türevleri analitik (kesit / eksen eşlemesi sabit): anizotropik süzgeç boyunca uzamış lifi korur
  vec2 ddx = ax == 0 ? vec2(fp.x * tpm / uFiberSize, 0.0) : vec2(0.0, fp.x * tAlong);
  vec2 ddy = ax == 0 ? vec2(0.0, fp.y * tAlong) : vec2(fp.y * tpm / uFiberSize, 0.0);
  float acrossTex = (ax == 0 ? fp.x : fp.y) * tpm;           // piksel başına enine texel
  float fib;
  if (textured) {
    // Tekstüre: ince kıvrımlı lif — doku iki eksende eşit ölçekte (izotrop kıvrım), ayak izinden söner
    vec2 tq = vec2(cross, s) * tpm * 0.35 / uFiberSize + 0.5 * t2.yz;
    vec2 dq = fp * tpm * 0.35 / uFiberSize;
    fib = textureGrad(uFiber, tq.yx, vec2(dq.x, 0.0), vec2(0.0, dq.y)).r * (1.0 - smoothstep(1.0, 4.0, max(dq.x, dq.y) * uFiberSize));
  } else if (single) {
    // Tek kat: lif dokusu sarmal (lif) yönünde uzamış — doku x = liflere dik, y = lif boyunca
    vec2 tq = vec2(nH * tpm, tH * tpm * 0.5) / uFiberSize + 0.5 * t2.yz;
    vec2 dq = fp * tpm / uFiberSize;
    fib = textureGrad(uFiber, tq, vec2(dq.x, 0.0), vec2(0.0, dq.y)).r * (1.0 - smoothstep(1.0, 4.0, acrossTex));
  } else {
    fib = textureGrad(uFiber, tc, ddx, ddy).r * (1.0 - smoothstep(1.0, 4.0, acrossTex));
  }
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

// v2 iplik tablosu: satır 4·eksen + k, indeks mod periyot
vec4 thr(int ax, int idx, int row) {
  return texelFetch(uThreads, ivec2(pmod(idx, ax == 0 ? uPeriod.x : uPeriod.y), ax * 4 + row), 0);
}
// indeks önceden mod periyot alınmış (aday başına tek pmod)
vec4 thrP(int ax, int ip, int row) { return texelFetch(uThreads, ivec2(ip, ax * 4 + row), 0); }
vec4 czP(int ip, int jp) { return texelFetch(uCross, ivec2(ip, jp), 0); }
// geometry.ts crimpEase: uç flotte içindeyse iplik düz çıkar, bükülme bağlantı ucunda (P = 2.5). (f, df/dt)
vec2 crimpEase(float t, bool fl0, bool fl1) {
  float x = clamp(t, 0.0, 1.0);
  float g = 0.5 - 0.5 * cos(PI * x);
  float dg = 0.5 * PI * sin(PI * x);
  const float P = 2.0;
  if (fl0 && !fl1) return vec2(pow(g, P), P * pow(g, P - 1.0) * dg);
  if (fl1 && !fl0) return vec2(1.0 - pow(1.0 - g, P), P * pow(1.0 - g, P - 1.0) * dg);
  return vec2(g, dg);
}
float cV2(int ax, int idx) { return (float(idx) + 0.5) * (ax == 0 ? uPitchMm.x : uPitchMm.y) + thr(ax, idx, 0).y; }
// relief.ts thicknessAlong / wobble (frekanslar döşemeye yuvarlanmış uniform)
float alongV2(int ax, vec4 t1, float s) {
  if (uAlongMul <= 0.0) return 1.0;
  vec2 fr = ax == 0 ? uFreqW.xy : uFreqF.xy;
  return 1.0 + (ax == 0 ? 0.06 : 0.07) * uAlongMul * sin(fr.x * s + t1.x) * sin(fr.y * s + t1.y);
}
float wobV2(int ax, vec4 t1, vec4 t2, float s) {
  if (uAlongMul <= 0.0) return 0.0;
  if (ax == 0) {
    float A = 0.025 * 1.7320508 * uAlongMul;
    return A * t1.z * sin(uFreqW.z * s + t2.x) + A * t1.w * sin(uFreqW.w * s + 3.0);
  }
  return 0.03 * 1.7320508 * uAlongMul * t1.z * sin(uFreqF.z * s + t2.x);
}

// Faz 2 / classic: tek katman, en yüksek kazanır (CPU heightfield tutarlılığı için değişmedi)
void classicMain(float X, float Y) {
  float pw = uPitchMm.x;
  float pf = uPitchMm.y;
  float beta = uCrimpShare;
  int jN = nearestWeft(Y);
  int iN = nearestWarp(X);
  float rfN = weftR(jN);
  float rwN = warpR(iN);
  float bestH = -1e3; float bestAxis = 0.0; float bestIdx = 0.0; float bestV = 0.0; vec2 bestG = vec2(0.0);
  int k0 = int(floor(Y / pf - 0.5));
  if (Y < weftC(k0)) k0 -= 1; else if (Y >= weftC(k0 + 1)) k0 += 1;
  float c0 = weftC(k0); float c1 = weftC(k0 + 1);
  float s = clamp((Y - c0) / (c1 - c0), 0.0, 1.0);
  float f = ss(s);
  float dsW = 6.0 * s * (1.0 - s) / (c1 - c0);
  int i0 = int(floor(X / pw));
  for (int di = -1; di <= 1; di++) {
    int i = i0 + di;
    float rw = warpR(i);
    float k = flattening(2.0 * rw, pw);
    float a = rw * sqrt(k); float b = rw / sqrt(k);
    float dx = X - warpC(i);
    if (!(abs(dx) < a)) continue;
    float amp = (rw + rfN) * beta;
    float s0 = warpUp(i, k0) ? 1.0 : -1.0;
    float s1 = warpUp(i, k0 + 1) ? 1.0 : -1.0;
    float u = dx / a;
    float h = (s0 * (1.0 - f) + s1 * f) * amp + 0.6 * b * sqrt(max(0.0, 1.0 - u * u));
    if (h > bestH) { bestH = h; bestAxis = 1.0; bestIdx = float(i); bestV = u; bestG = vec2(slope(u, a, b, 0.6), (s1 - s0) * amp * dsW); }
  }
  float bestWarpH = bestAxis == 1.0 ? bestH : -1e3;
  int k2 = int(floor(X / pw - 0.5));
  if (X < warpC(k2)) k2 -= 1; else if (X >= warpC(k2 + 1)) k2 += 1;
  float e0 = warpC(k2); float e1 = warpC(k2 + 1);
  float s2 = clamp((X - e0) / (e1 - e0), 0.0, 1.0);
  float f2 = ss(s2);
  float dsF = 6.0 * s2 * (1.0 - s2) / (e1 - e0);
  int j0 = int(floor(Y / pf));
  for (int dj = -1; dj <= 1; dj++) {
    int j = j0 + dj;
    float rf0 = weftR(j);
    float k = flattening(2.0 * rf0, pf);
    float a = rf0 * sqrt(k); float b = rf0 / sqrt(k);
    float dy = Y - weftC(j);
    if (!(abs(dy) < a)) continue;
    float amp = (rwN + rf0) * (1.0 - beta);
    float q0 = warpUp(k2, j) ? -1.0 : 1.0;
    float q1 = warpUp(k2 + 1, j) ? -1.0 : 1.0;
    float u = dy / a;
    float h = (q0 * (1.0 - f2) + q1 * f2) * amp + 0.6 * b * sqrt(max(0.0, 1.0 - u * u));
    if (h > bestH && h > bestWarpH) { bestH = h; bestAxis = 2.0; bestIdx = float(j); bestV = u; bestG = vec2((q1 - q0) * amp * dsF, slope(u, a, b, 0.6)); }
  }
  gb3 = vec4(0.0, 0.0, 0.0, 0.0);
  if (bestH <= uBgHeight + 1e-6) {
    gb0 = vec4(uBgHeight, 0.0, 0.0, 0.0);
    gb1 = vec4(0.0, 0.0, 0.0, 0.0);
    gb2 = vec4(0.0, 0.0, 0.0, max(uBgHeight / uRRef, -2.2));
    return;
  }
  vec3 n = normalize(vec3(-bestG, 1.0));
  gb0 = vec4(bestH, mod(bestAxis == 1.0 ? Y : X, 16.0), bestV, bestIdx);
  gb1 = vec4(n.xy, bestAxis, 1.0);
  gb2 = vec4(0.76, 0.0, 0.0, max(bestH / uRRef, -2.2));
}

// v2 (fix-v3) aday: taban yükseklik (rölyefsiz) ve kenar kapsaması
struct Cand { float h; float axis; int idx; float u; float prof; float cov; vec2 g; float cross; float a; };
Cand noCand() { return Cand(-1e3, 0.0, 0, 0.0, 0.0, 0.0, vec2(0.0), 0.0, 1.0); }
void pushCand(inout Cand t1, inout Cand t2, Cand c) {
  if (c.h > t1.h) { t2 = t1; t1 = c; } else if (c.h > t2.h) { t2 = c; }
}

void v2Main(float X, float Y, vec2 fp) {
  float pw = uPitchMm.x;
  float pf = uPitchMm.y;
  Cand t1 = noCand();
  Cand t2 = noCand();

  // Çözgü adayları: kesişim z'leri (uCross.x) arasında cosine geçiş
  int k0 = int(floor(Y / pf - 0.5));
  float c0 = cV2(1, k0); float c1 = cV2(1, k0 + 1);
  if (Y < c0) { k0 -= 1; c1 = c0; c0 = cV2(1, k0); } else if (Y >= c1) { k0 += 1; c0 = c1; c1 = cV2(1, k0 + 1); }
  float s = clamp((Y - c0) / (c1 - c0), 0.0, 1.0);
  float f = cs(s);
  float dsW = 0.5 * PI * sin(PI * s) / (c1 - c0);
  // Atkıların krepaj aralığı: X'i çevreleyen iki çözgü merkezi (k2, k2 + 1)
  int k2 = int(floor(X / pw - 0.5));
  float e0 = cV2(0, k2); float e1 = cV2(0, k2 + 1);
  if (X < e0) { k2 -= 1; e1 = e0; e0 = cV2(0, k2); } else if (X >= e1) { k2 += 1; e0 = e1; e1 = cV2(0, k2 + 1); }
  float s2 = clamp((X - e0) / (e1 - e0), 0.0, 1.0);
  float f2 = cs(s2);
  float dsF = 0.5 * PI * sin(PI * s2) / (e1 - e0);
  // Adaylar: noktayı çevreleyen iki merkez yeter (kesit yarı genişliği < aralık); çok kalın iplikte uSpan = 2
  int k0p = pmod(k0, uPeriod.y);
  int k0q = k0p + 1 == uPeriod.y ? 0 : k0p + 1;
  int k2p = pmod(k2, uPeriod.x);
  int k2q = k2p + 1 == uPeriod.x ? 0 : k2p + 1;
  // sabit sınırlı döngü (sürücü açabilsin); uSpan dışı adaylar atlanır
  for (int di = -1; di <= 2; di++) {
    if (di < 1 - uSpan || di > uSpan) continue;
    int i = k2 + di;
    int ip = pmod(i, uPeriod.x);
    vec4 ta = thrP(0, ip, 0); vec4 tb = thrP(0, ip, 1); vec4 tc2 = thrP(0, ip, 2);
    float rw = ta.x * alongV2(0, tb, Y / pf);
    float k = ta.z;
    float a = rw * sqrt(k); float b = rw / sqrt(k);
    float dx = X - ((float(i) + 0.5) * pw + ta.y) - wobV2(0, tb, tc2, Y / pf) * pw;
    // kenar yumuşatma için silüetin yarım piksel dışına kadar aday
    if (!(abs(dx) < a + max(fp.x, max(tc2.w, uSoftEdge) * a))) continue;
    vec4 q0 = czP(ip, k0p); vec4 q1 = czP(ip, k0q);
    float z0 = q0.x; float z1 = q1.x;
    vec2 eW = crimpEase(s, q0.z > 0.5, q1.z > 0.5);
    float u = clamp(dx / a, -1.0, 1.0);
    float prof = b * sqrt(max(0.0, 1.0 - u * u));
    // Kenar kapsaması; tekstürede kabarık saçak: geçiş genişliği max(piksel, yumuşaklık·a)
    float cov = clamp(0.5 + (a - abs(dx)) / max(fp.x, max(tc2.w, uSoftEdge) * a), 0.0, 1.0);
    pushCand(t1, t2, Cand(mix(z0, z1, eW.x) + prof, 1.0, i, u, prof, cov, vec2(slope(u, a, b, 1.0), (z1 - z0) * eW.y / (c1 - c0)), dx, a));
  }

  // Atkı adayları (uCross.y); eşitlikte çözgü üstte (sıkı büyüktür)
  for (int dj = -1; dj <= 2; dj++) {
    if (dj < 1 - uSpan || dj > uSpan) continue;
    int j = k0 + dj;
    int jp = pmod(j, uPeriod.y);
    vec4 ta = thrP(1, jp, 0); vec4 tb = thrP(1, jp, 1); vec4 tc2 = thrP(1, jp, 2);
    float rf0 = ta.x * alongV2(1, tb, X / pw);
    float k = ta.z;
    float a = rf0 * sqrt(k); float b = rf0 / sqrt(k);
    float dy = Y - ((float(j) + 0.5) * pf + ta.y) - wobV2(1, tb, tc2, X / pw) * pf;
    if (!(abs(dy) < a + max(fp.y, max(tc2.w, uSoftEdge) * a))) continue;
    vec4 q0 = czP(k2p, jp); vec4 q1 = czP(k2q, jp);
    float z0 = q0.y; float z1 = q1.y;
    vec2 eF = crimpEase(s2, q0.w > 0.5, q1.w > 0.5);
    float u = clamp(dy / a, -1.0, 1.0);
    float prof = b * sqrt(max(0.0, 1.0 - u * u));
    float cov = clamp(0.5 + (a - abs(dy)) / max(fp.y, max(tc2.w, uSoftEdge) * a), 0.0, 1.0);
    pushCand(t1, t2, Cand(mix(z0, z1, eF.x) + prof, 2.0, j, u, prof, cov, vec2((z1 - z0) * eF.y / (e1 - e0), slope(u, a, b, 1.0)), dy, a));
  }

  bool has1 = t1.axis > 0.5;
  bool has2 = uLayered == 1 && t2.axis > 0.5;
  // Rölyef yalnız üst katman için (kat oluğu, ince lif, lif gürültüsü)
  vec3 rel = vec3(0.76, 0.0, 0.0);
  float hRel = 0.0;
  vec2 gRel = vec2(0.0);
  float h1 = uBgHeight;
  if (has1) {
    bool w = t1.axis < 1.5;
    int ax = w ? 0 : 1;
    float relief = uRelief;
    if (relief > 0.0) {
      vec4 r0 = thr(ax, t1.idx, 0); vec4 r2 = thr(ax, t1.idx, 2); vec4 r3 = thr(ax, t1.idx, 3);
      // Atkıda enine eksen −y: Z oluklar ekranda "\" (relief.ts plyPhase)
      vec2 dP;
      rel = w ? reliefTerms(0, r0, r2, r3, Y, t1.u, t1.cross, t1.a, fp, dP) : reliefTerms(1, r0, r2, r3, X, -t1.u, -t1.cross, t1.a, fp, dP);
      float amp = t1.prof * relief;
      // Kat payı tek katta sığ şerit (reliefTerms içinde ±0.12 ile sınırlı); tekstürede kıvrım payı büyük (0.10)
      hRel = amp * (PLY_H * (rel.x - 0.76) + (r3.z > 2.5 ? 0.10 : 0.03) * rel.z);
      // Kat bombesi eğimi (ekran x, y): çözgüde (enine, boyunca), atkıda (boyunca, −enine)
      gRel = amp * PLY_H * (w ? vec2(dP.y, dP.x) : vec2(dP.x, -dP.y));
    }
    h1 = t1.h + hRel;
  }
  if (!has1) {
    gb0 = vec4(uBgHeight, 0.0, 0.0, 0.0);
    gb1 = vec4(0.0, 0.0, 0.0, 0.0);
    // Boşluk AO yüksekliği: prototip −2.2 (çözgü yarıçapı birimi)
    gb2 = vec4(0.0, 0.0, 0.0, max(uBgHeight / uRRef, -2.2));
    gb3 = vec4(0.0);
    return;
  }
  // Kapsama: silüet × (üst / alt kesişim çizgisinde yükseklik farkı / eğim farkı · piksel ayak izi)
  float cov = uLayered == 1 ? t1.cov : 1.0;
  if (has2) {
    float dh = h1 - t2.h;
    float gd = length(t1.g - t2.g) * length(fp) * 0.7071 + 1e-5;
    cov *= clamp(0.5 + dh / gd, 0.0, 1.0);
  }
  // gb1.xy = yalnız boyunca (krepaj) eğimi + kat detayı; enine eğim ışık geçişinde yuvarlak kesitten analitik gelir
  vec2 along = t1.axis < 1.5 ? vec2(0.0, t1.g.y) : vec2(t1.g.x, 0.0);
  vec2 grad = clamp(along + gRel, -4.0, 4.0);
  vec3 n = normalize(vec3(-grad, 1.0));
  gb0 = vec4(h1, mod(t1.axis < 1.5 ? Y : X, 16.0), t1.u, float(t1.idx));
  gb1 = vec4(n.xy, t1.axis, cov);
  gb2 = vec4(rel, max(h1 / uRRef, -2.2));
  if (has2) {
    vec3 n2 = normalize(vec3(-clamp(t2.g, -4.0, 4.0), 1.0));
    // .y = sistem + 0.9·kenar kapsaması (sistem 1/2 tamsayı, kesir kapsama)
    gb3 = vec4(float(t2.idx), t2.axis + 0.9 * t2.cov, n2.xy);
  } else {
    gb3 = vec4(0.0);
  }
}

void main() {
  vec2 mm = fabricWarp(uOffsetMm + (gl_FragCoord.xy - 0.5) / uPxPerMmXY);
  // Piksel ayak izi (mm): fwidth tabanlı (döşemede x / y yoğunluğu farklı olabilir)
  vec2 fp = max(fwidth(mm), vec2(1e-6));
  if (uModel == 1) v2Main(mm.x, mm.y, fp);
  else classicMain(mm.x, mm.y);
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
