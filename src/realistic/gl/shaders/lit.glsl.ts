/**
 * Işık geçişleri (fix-v2; reference/realistic-v2/prototip_render_v2.py).
 *
 * Adım 2 (önbellek): OCCLUSION_FS her karede değil, döşeme pişirilirken bir kez çalışır (uWrap = 1:
 * komşular döşeme kenarında sarmalanır). LIT_FS ao / gölgeyi ve tüy katmanını döşeme dokularından
 * `mm / döşeme` ile okur; gezinmede pahalı geçiş yoktur.
 *
 * OCCLUSION_FS → RGBA8 (ao, gölge, 0, 1):
 *  - Çok ölçekli AO (prototip): Σ ağırlık·max(kutu ortalaması(H) − H, 0), yarıçap 0.35 / 0.9 / 2.0 çözgü
 *    aralığı, ağırlık 1 / 0.9 / 0.5; ao = clamp(1 − 0.6·şiddet·Σ, 0.05, 1). H çözgü yarıçapı biriminde
 *    (gb2.w). Kutu ortalaması gb2 mip zincirinden 4 örnekle (her karede büyük filtre yok).
 *  - Yönlü gölge (prototip ray-march): ışığa doğru 1.2·aralık boyunca; örnek yükseklik ışın yüksekliğini
 *    aştıkça yumuşak eşik 0.15·aralık ile kararır, güç 0.75. Kalite adımları belirler (0 = kapalı).
 *
 * LIT_FS → ekran (sRGB):
 *  - Normal: yükseklikten (kat rölyefi dahil) 3×3 yumuşatılmış merkezi fark, eğim ±4'te kırpılır;
 *    yalnız aynı iplik yüzeyindeki komşular (iplik / boşluk sınırında tek taraflı fark).
 *  - Difüz wrap: N·L·0.75 + 0.25.
 *  - Kajiya-Kay iki lob: teğet = iplik ekseni + eğim; 0.05·s^12 + 0.10·s^90 (× parlaklık × speküler ayarı;
 *    üsler speküler genişliğe bölünür).
 *  - Kavite: 0.55 + 0.45·kat profili (oluklarda kararma).
 *  - Birleştirme: albedo·(0.22·ao + 0.95·difüz·gölge·ao)·kavite + speküler·gölge·ao·kavite; ×1.25 pozlama.
 *  - Boşluk: sıcak koyu gri (0.006, 0.005, 0.004) doğrusal, ao ve ışıkla hafif modüle.
 *  - Melanj (C): albedo × (1 + 0.10·lif gürültüsü + 0.05·ince lif) — iplik boyunca uzamış.
 *  - Tüylülük (D): pişirilmiş saydam lif katmanı; renk kök ipliğin ışıklı rengi ×1.15 + 12/255 (sRGB'de).
 * Tüm sayılar prototipten; VARSAYIM olarak gerçek numuneyle kalibre edilecek.
 */
import { COMMON_GLSL } from './flat.glsl';

/** Ortak: tamsayı hash (pcg3d) ve 2B değer gürültüsü. Faz 4'ün JS ikizi aynı bit işlemlerini kullanır. */
export const NOISE_GLSL = /* glsl */ `
uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
float hash01(ivec2 c, uint s) {
  // Negatif tamsayıyı uint'e çevirmek tanımsız olabilir: pozitif aralığa kaydır.
  uvec3 h = pcg3d(uvec3(uvec2(c + ivec2(1 << 20)), s));
  return float(h.x & 0xffffffu) / 16777215.0;
}
float vnoise(vec2 p, uint s) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  ivec2 c = ivec2(i);
  float a = hash01(c, s), b = hash01(c + ivec2(1, 0), s);
  float d = hash01(c + ivec2(0, 1), s), e = hash01(c + ivec2(1, 1), s);
  return mix(mix(a, b, f.x), mix(d, e, f.x), f.y) * 2.0 - 1.0;
}
`;

export const OCCLUSION_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uGb0;        // yükseklik mm (NEAREST)
uniform sampler2D uGb2;        // .w yükseklik / r_ref, mip'li
uniform ivec2 uSize;
uniform float uPxPerMm;
uniform float uPitchPx;        // çözgü aralığı (px) — prototip pw
uniform int uAoScales;         // 1..3
uniform float uAoStrength;
uniform int uShadowSteps;      // 0 = kapalı
uniform vec3 uLightDir;
uniform float uRRef;           // gb2.w birimi (mm)
uniform int uWrap;             // 1: döşeme pişirme — komşular kenarda sarmalanır

out vec4 outOcc;
${COMMON_GLSL}
ivec2 at(ivec2 q) { return uWrap == 1 ? ivec2(pmod(q.x, uSize.x), pmod(q.y, uSize.y)) : clamp(q, ivec2(0), uSize - 1); }
float hMm(ivec2 q) { return texelFetch(uGb0, at(q), 0).x; }
float hR(ivec2 q) { return texelFetch(uGb2, at(q), 0).w; }
// R×R kutu ortalaması (yaklaşık): 4 örnek, her biri R/2 genişlikte mip seviyesinden
float boxMean(vec2 p, float R) {
  float lod = max(0.0, log2(max(R * 0.5, 1.0)));
  vec2 inv = 1.0 / vec2(uSize);
  float o = R * 0.25;
  return 0.25 * (textureLod(uGb2, (p + vec2(-o, -o)) * inv, lod).w + textureLod(uGb2, (p + vec2(o, -o)) * inv, lod).w
               + textureLod(uGb2, (p + vec2(-o, o)) * inv, lod).w + textureLod(uGb2, (p + vec2(o, o)) * inv, lod).w);
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec2 pc = gl_FragCoord.xy;
  float h0 = hR(p);

  // Çok ölçekli AO
  float acc = 0.0;
  acc += 1.0 * max(boxMean(pc, 0.35 * uPitchPx) - h0, 0.0);
  if (uAoScales >= 2) acc += 0.9 * max(boxMean(pc, 0.9 * uPitchPx) - h0, 0.0);
  if (uAoScales >= 3) acc += 0.5 * max(boxMean(pc, 2.0 * uPitchPx) - h0, 0.0);
  // Ölçek azaltıldığında toplam şiddet korunur (yaklaşık): 1 ölçekte ×2.4, 2 ölçekte ×1.26
  acc *= uAoScales >= 3 ? 1.0 : (uAoScales == 2 ? 1.26 : 2.4);
  float ao = clamp(1.0 - 0.6 * uAoStrength * acc, 0.05, 1.0);

  // Yönlü gölge: ışığa doğru ray-march
  float sh = 1.0;
  if (uShadowSteps > 0) {
    vec2 dir = normalize(uLightDir.xy + vec2(1e-6));
    float slopeL = uLightDir.z / max(length(uLightDir.xy), 1e-4);  // px yükseklik / px
    float hp0 = hMm(p) * uPxPerMm;
    float len = 1.2 * uPitchPx;
    float stride = max(1.0, len / float(uShadowSteps));
    float thr = 0.15 * uPitchPx;
    for (int k = 1; k <= 64; k++) {
      if (k > uShadowSteps) break;
      float t = float(k) * stride;
      if (t > len) break;
      float hs = hMm(p + ivec2(round(dir * t))) * uPxPerMm;
      float occ = clamp((hs - (hp0 + t * slopeL)) / thr, 0.0, 1.0);
      sh = min(sh, 1.0 - 0.75 * occ);
    }
  }
  outOcc = vec4(ao, sh, 0.0, 1.0);
}
`;

export const LIT_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;

uniform sampler2D uGb0;
uniform sampler2D uGb1;
uniform sampler2D uGb2;
uniform sampler2D uOccTile;     // pişirilmiş (ao, gölge) döşemesi, LINEAR + REPEAT
uniform sampler2D uHairTile;    // pişirilmiş tüy katmanı (önçarpımlı RGBA), mip'li + REPEAT
uniform int uHairOn;            // yüksek kalitede 1
uniform float uMelange;         // melanj genliği çarpanı (1 = prototip ±%10 / ±%5)
uniform ivec2 uPeriod;
uniform vec2 uTileMm;
uniform vec2 uOffsetMm;
uniform vec2 uPxPerMmXY;
uniform sampler2D uWarpColor;
uniform sampler2D uWeftColor;
uniform usampler2D uWarpType;
uniform usampler2D uWeftType;
uniform sampler2D uYarnTypes;
uniform int uWarpCount;
uniform int uWeftCount;
uniform ivec2 uSize;
uniform float uPxPerMm;
uniform vec3 uLightDir;
uniform float uLusterMul[3];    // mat / yarı mat / parlak → speküler çarpanı
uniform float uSpecMul;
uniform float uSpecWidthMul;
uniform uint uSeed;             // Faz 4 tohum
uniform float uColorDE;         // renk sapması (OKLab×100)
uniform float uExposure;        // prototip ×1.25

out vec4 outColor;
${COMMON_GLSL}
${NOISE_GLSL}
vec3 toLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
float threadRand(int axis, int idx, int ch) {
  int per = axis == 0 ? uPeriod.x : uPeriod.y;
  return hash01(ivec2(pmod(idx, per), axis * 16 + ch), uSeed) * 2.0 - 1.0;
}
// OKLab (Björn Ottosson), doğrusal sRGB ↔ OKLab
vec3 toOklab(vec3 c) {
  float l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
  float m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
  float s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
  l = pow(max(l, 0.0), 1.0 / 3.0); m = pow(max(m, 0.0), 1.0 / 3.0); s = pow(max(s, 0.0), 1.0 / 3.0);
  return vec3(0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
              1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
              0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s);
}
vec3 fromOklab(vec3 c) {
  float l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  float m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  float s = c.x - 0.0894841775 * c.y - 1.291485548 * c.z;
  l = l * l * l; m = m * m * m; s = s * s * s;
  return vec3(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
             -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
             -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
}
float hAt(ivec2 q) { return texelFetch(uGb0, clamp(q, ivec2(0), uSize - 1), 0).x; }
// Komşu aynı iplik yüzeyinde değilse (başka iplik / boşluk) yükseklik sıçraması normale girmesin:
// tek taraflı fark (merkez yüksekliği). Prototip bu kenarı gauss ile yumuşatıyordu; burada parlak dikiş
// çizgisi yapıyordu.
float hSame(ivec2 q, vec2 id0, float h0) {
  ivec2 c = clamp(q, ivec2(0), uSize - 1);
  vec4 n0 = texelFetch(uGb0, c, 0);
  float ax = texelFetch(uGb1, c, 0).z;
  return (ax == id0.x && n0.w == id0.y) ? n0.x : h0;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 g0 = texelFetch(uGb0, p, 0);
  vec4 g1 = texelFetch(uGb1, p, 0);
  vec4 g2 = texelFetch(uGb2, p, 0);
  // AO ve gölge: pişirilmiş döşemeden (kumaş uzayı, mm mod döşeme; doğrusal süzgeç yumuşatır)
  vec2 mm = uOffsetMm + (gl_FragCoord.xy - 0.5) / uPxPerMmXY;
  vec2 tuv = mm / uTileMm;
  vec2 occ = texture(uOccTile, tuv).xy;
  float ao = occ.x;
  float sh = occ.y;
  vec3 L = normalize(uLightDir);
  // Tüy katmanı (önçarpımlı): ışık düz yüzey normaliyle
  vec4 hair = uHairOn == 1 ? texture(uHairTile, tuv) : vec4(0.0);
  float diffFlat = clamp(L.z * 0.75 + 0.25, 0.0, 1.0);
  float lightFlat = 0.22 * ao + 0.95 * diffFlat * sh * ao;

  if (g1.z < 0.5) {
    // Boşluk: sıcak koyu gri, ışık ve AO ile hafif (VARSAYIM 0.7 + 0.3·ao·gölge)
    vec3 gap = vec3(0.006, 0.005, 0.004) * (0.7 + 0.3 * ao * sh);
    vec3 outS = toSrgb(gap * uExposure);
    if (hair.a > 1e-4) outS = mix(outS, clamp(toSrgb(toLinear(hair.rgb / hair.a) * lightFlat * uExposure) * 1.15 + 12.0 / 255.0, 0.0, 1.0), hair.a);
    outColor = vec4(outS, 1.0);
    return;
  }
  bool isWarp = g1.z < 1.5;
  int idx = int(round(g0.w));
  vec3 base = toLinear(isWarp
    ? texelFetch(uWarpColor, ivec2(pmod(idx, uWarpCount), 0), 0).rgb
    : texelFetch(uWeftColor, ivec2(pmod(idx, uWeftCount), 0), 0).rgb);
  // Faz 4: iplik başına renk sapması (OKLab; ağırlık L 1, a 0.4, b 0.4; |Δ| ≤ ΔE/100)
  if (uColorDE > 0.0) {
    int ax = isWarp ? 0 : 1;
    float kc = uColorDE / (100.0 * 1.1489125); // |(1, 0.4, 0.4)|
    vec3 dLab = kc * vec3(1.0, 0.4, 0.4) * vec3(threadRand(ax, idx, 2), threadRand(ax, idx, 3), threadRand(ax, idx, 4));
    base = max(fromOklab(toOklab(base) + dLab), 0.0);
  }
  uint ty = isWarp
    ? texelFetch(uWarpType, ivec2(pmod(idx, uWarpCount), 0), 0).r
    : texelFetch(uWeftType, ivec2(pmod(idx, uWeftCount), 0), 0).r;
  vec4 yt = texelFetch(uYarnTypes, ivec2(int(ty), 0), 0); // (d, ±T tur/mm, parlaklık, tüy)
  int lusterIdx = clamp(int(round(yt.z)), 0, 2);

  // Normal: yükseklikten 3×3 (Sobel) merkezi fark; eğim mm/mm, ±4'te kırpılır (prototip)
  vec2 id0 = vec2(g1.z, g0.w);
  float hc = g0.x;
  float hl = hSame(p + ivec2(-1, 0), id0, hc), hr = hSame(p + ivec2(1, 0), id0, hc);
  float hd = hSame(p + ivec2(0, -1), id0, hc), hu = hSame(p + ivec2(0, 1), id0, hc);
  float hld = hSame(p + ivec2(-1, -1), id0, hc), hrd = hSame(p + ivec2(1, -1), id0, hc);
  float hlu = hSame(p + ivec2(-1, 1), id0, hc), hru = hSame(p + ivec2(1, 1), id0, hc);
  // Δh (mm) / Δx (px) × px/mm → eğim (mm/mm)
  vec2 gpx = vec2((hr - hl) * 2.0 + (hru - hlu) + (hrd - hld), (hu - hd) * 2.0 + (hru - hrd) + (hlu - hld)) / 8.0;
  vec2 grad = clamp(gpx * uPxPerMm, -4.0, 4.0);
  vec3 N = normalize(vec3(-grad, 1.0));

  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 H = normalize(L + V);
  float diff = clamp(dot(N, L) * 0.75 + 0.25, 0.0, 1.0);
  // Kajiya-Kay: teğet iplik ekseni + eğim (prototip T = (0, 1, gy) çözgü, (1, 0, gx) atkı)
  vec3 Tn = normalize(isWarp ? vec3(0.0, 1.0, grad.y) : vec3(1.0, 0.0, grad.x));
  float TH = dot(Tn, H);
  float sinTH = sqrt(clamp(1.0 - TH * TH, 0.0, 1.0));
  float w = max(uSpecWidthMul, 0.05);
  float spec = (0.05 * pow(sinTH, 12.0 / w) + 0.10 * pow(sinTH, 90.0 / w)) * uLusterMul[lusterIdx] * uSpecMul;

  // Melanj (C): iplik boyunca uzamış lif gürültüsü ve ince liflerle albedo modülasyonu (prototip heather)
  base *= max(0.0, 1.0 + uMelange * (0.10 * g2.z + 0.05 * g2.y));
  float cav = clamp(0.55 + 0.45 * g2.x, 0.0, 1.0);
  float lightv = (0.22 * ao + 0.95 * diff * sh * ao) * cav;
  vec3 col = base * lightv + spec * sh * ao * cav;
  vec3 outS = toSrgb(col * uExposure);
  // Tüylülük (D): kök renginin ışıklı hali ×1.15 + 12 (prototip, sRGB'de), opaklıkla üstüne
  if (hair.a > 1e-4) outS = mix(outS, clamp(toSrgb(toLinear(hair.rgb / hair.a) * lightFlat * uExposure) * 1.15 + 12.0 / 255.0, 0.0, 1.0), hair.a);
  outColor = vec4(outS, 1.0);
}
`;

/** Mobil profil: tüm sahne döşemeye pişirildi; her karede yalnız döşenip gösterilir (mm mod döşeme). */
export const TILE_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uColorTile;   // sRGB RGBA8, mip'li + REPEAT
uniform vec2 uTileMm;
uniform vec2 uOffsetMm;
uniform vec2 uPxPerMmXY;
out vec4 outColor;
void main() {
  vec2 mm = uOffsetMm + (gl_FragCoord.xy - 0.5) / uPxPerMmXY;
  outColor = vec4(texture(uColorTile, mm / uTileMm).rgb, 1.0);
}
`;
