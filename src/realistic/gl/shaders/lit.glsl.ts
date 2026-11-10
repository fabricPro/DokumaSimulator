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
 *  - Normal: G-buffer'dan (fix-v3: analitik taban eğimi + rölyefin ekran türevi; v2'deki 3×3 Sobel kalktı).
 *  - Katmanlı: alt katman (gb3) basit difüzle gölgelenir, üst katman kapsamasıyla (gb1.w) karıştırılır.
 *  - AO tabanı iplik pikselinde 0.35 (açık dokuda alttaki iplik kararır, kaybolmaz).
 *  - Difüz wrap: N·L·0.75 + 0.25.
 *  - Kajiya-Kay iki lob: teğet = iplik ekseni + eğim; 0.05·s^12 + 0.10·s^90 (× parlaklık × speküler ayarı;
 *    üsler speküler genişliğe bölünür).
 *  - Kavite: 0.55 + 0.45·kat profili (oluklarda kararma).
 *  - Birleştirme: albedo·(0.22·ao + 0.95·difüz·gölge·ao)·kavite + speküler·gölge·ao·kavite; ×1.25 pozlama.
 *  - Zemin (Tuning.background): koyu gri (doğrusal ≈ 0.02, varsayılan) / siyah / arkadan ışık (boşluk aydınlık,
 *    iplik koyu siluet + kalınlığa bağlı geçirgenlik + kenar ışığı).
 *  - Melanj (C): albedo × (1 + 0.045·lif gürültüsü + 0.015·ince lif) ≈ ±%6 — iplik boyunca uzamış.
 *  - Tüylülük (D): pişirilmiş saydam lif katmanı; renk kök ipliğin ışıklı rengi ×1.05 + 4/255 (sRGB'de).
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
uniform float uContact;        // kontakt gölge şiddeti (0 = kapalı, 1 = varsayılan)

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

  // Kontakt gölge (fix-v4): üstteki iplik, yanındaki alçak yüzeye (altından geçen iplik) 0.4·d_üst genişlikte yumuşak
  // gölge düşürür: 8 yönde iki yarıçapta (R, R/2) komşu yükseklik farkı; kesitin iki yanında da çalışır.
  if (uContact > 0.0) {
    float rr = max(uRRef, 1e-4);
    float R = 0.8 * rr * uPxPerMm;
    float h0m = hMm(p);
    float mx = 0.0;
    float sum = 0.0;
    for (int k = 0; k < 8; k++) {
      float ang = 0.7853982 * float(k);
      vec2 o = vec2(cos(ang), sin(ang));
      float c1 = clamp((hMm(p + ivec2(round(o * R))) - h0m - 0.15 * rr) / (0.8 * rr), 0.0, 1.0);
      float c2 = clamp((hMm(p + ivec2(round(o * R * 0.5))) - h0m - 0.15 * rr) / (0.8 * rr), 0.0, 1.0);
      float c = max(c1, c2);
      mx = max(mx, c);
      sum += c;
    }
    float contact = 0.6 * mx + 0.4 * sum * 0.125;
    ao = max(ao * (1.0 - 0.55 * clamp(uContact, 0.0, 1.5) * contact), 0.05);
  }

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
uniform sampler2D uGb3;         // alt katman (fix-v3)
uniform int uBg;                // zemin: 0 koyu gri, 1 siyah, 2 arkadan ışık
uniform int uAnalyticN;         // 1: enine normal yuvarlak kesitten analitik (v2); 0: gb1'den (classic)
uniform float uWhite;           // ton eşlemede beyaz noktası (pozlama sonrası doğrusal)
uniform sampler2D uThreads;     // iplik tablosu (pack.ts threadTable): basıklık k
uniform sampler2D uThreadColor; // RGBA32F, döşeme periyodu × 2 (çözgü, atkı): doğrusal albedo
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
// Ton eşleme (fix-v4): 0.75 altı aynen, üstü yumuşak omuz (genişletilmiş Reinhard, beyaz noktası uWhite) → beyaz yanmaz
vec3 tone(vec3 x) {
  const float k = 0.75;
  float wu = (uWhite - k) / (1.0 - k);
  vec3 u = max(x - k, 0.0) / (1.0 - k);
  vec3 hi = k + (1.0 - k) * u * (1.0 + u / (wu * wu)) / (1.0 + u);
  return min(mix(x, hi, step(vec3(k), x)), vec3(1.0));
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
// İplik albedosu (doğrusal, Faz 4 OKLab renk sapması dahil): iplik başına bir kez CPU'da (pack.ts threadColors)
vec3 threadBase(bool isWarp, int idx) {
  return texelFetch(uThreadColor, ivec2(pmod(idx, isWarp ? uPeriod.x : uPeriod.y), isWarp ? 0 : 1), 0).rgb;
}
vec4 threadYarn(bool isWarp, int idx) {
  uint ty = isWarp
    ? texelFetch(uWarpType, ivec2(pmod(idx, uWarpCount), 0), 0).r
    : texelFetch(uWeftType, ivec2(pmod(idx, uWeftCount), 0), 0).r;
  return texelFetch(uYarnTypes, ivec2(int(ty), 0), 0); // (d, ±T tur/mm, parlaklık, tüy)
}
// Zemin (doğrusal, pozlama öncesi). 0 koyu gri ≈ 0.02 (pozlamayla), 1 siyah, 2 arkadan ışık
vec3 gapColor(float ao, float sh) {
  if (uBg == 1) return vec3(0.0);
  if (uBg == 2) return vec3(0.80, 0.78, 0.74);
  return vec3(0.016) * (0.8 + 0.2 * ao * sh);
}
// Arkadan ışıkta iplik: koyu siluet + kalınlığa bağlı hafif geçirgenlik + kenar ışığı. v kesit içi, d çap
vec3 backlitThread(vec3 base, float v, float d, float diffv, float ao) {
  float chord = d * sqrt(max(0.0, 1.0 - v * v));
  float trans = exp(-chord / 0.12);                       // VARSAYIM: 0.12 mm'de 1/e (ince iplik daha geçirgen)
  float rim = pow(abs(v), 6.0);
  return base * (0.03 + 0.03 * diffv * ao) + base * 0.35 * trans * gapColor(1.0, 1.0) + vec3(0.10) * rim;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 g0 = texelFetch(uGb0, p, 0);
  vec4 g1 = texelFetch(uGb1, p, 0);
  vec4 g2 = texelFetch(uGb2, p, 0);
  vec4 g3 = texelFetch(uGb3, p, 0);
  // AO ve gölge: pişirilmiş döşemeden (kumaş uzayı, mm mod döşeme; doğrusal süzgeç yumuşatır)
  vec2 mm = uOffsetMm + (gl_FragCoord.xy - 0.5) / uPxPerMmXY;
  vec2 tuv = mm / uTileMm;
  vec2 occ = texture(uOccTile, tuv).xy;
  float ao = occ.x;
  float sh = occ.y;
  // İplik pikselinde AO tabanı: alttaki iplik kararır ama kaybolmaz (açık doku)
  float aoT = max(ao, 0.35);
  vec3 L = normalize(uLightDir);
  vec4 hair = uHairOn == 1 ? texture(uHairTile, tuv) : vec4(0.0);
  float diffFlat = clamp(L.z * 0.75 + 0.25, 0.0, 1.0);
  float lightFlat = 0.22 * aoT + 0.95 * diffFlat * sh * aoT;
  vec3 gap = gapColor(ao, sh);

  // Alt katman (kenarda / kesişim çizgisinde görünür): analitik taban normali, basit difüz; kenarı zemine karışır
  vec3 under = gap;
  float ax2 = floor(g3.y + 1e-3);
  // Üst katman tam kapsıyorsa alt katman görünmez: hesaplanmaz
  if (ax2 > 0.5 && !(g1.z > 0.5 && g1.w > 0.999)) {
    bool w2 = ax2 < 1.5;
    int idx2 = int(round(g3.x));
    float cov2 = clamp((g3.y - ax2) / 0.9, 0.0, 1.0);
    vec3 N2 = vec3(g3.zw, sqrt(max(0.0, 1.0 - dot(g3.zw, g3.zw))));
    float diff2 = clamp(dot(N2, L) * 0.75 + 0.25, 0.0, 1.0);
    vec3 b2 = threadBase(w2, idx2);
    vec3 c2 = uBg == 2 ? backlitThread(b2, 0.0, threadYarn(w2, idx2).x, diff2, aoT)
                       : b2 * (0.22 * aoT + 0.95 * diff2 * sh * aoT) * 0.85;
    under = mix(gap, c2, cov2);
  }

  vec3 col = under;
  float cov = 0.0;
  if (g1.z > 0.5) {
    bool isWarp = g1.z < 1.5;
    int idx = int(round(g0.w));
    cov = g1.w;
    vec3 base = threadBase(isWarp, idx);
    vec4 yt = threadYarn(isWarp, idx);
    int lusterIdx = clamp(int(round(yt.z)), 0, 2);
    vec3 N0 = vec3(g1.xy, sqrt(max(0.0, 1.0 - dot(g1.xy, g1.xy))));
    // gb1.xy: boyunca eğim + kat bombesi / lif detayı. v2'de enine eğim yuvarlak kesitten analitik (iplik
    // ortası aydınlık, kenara doğru kararır): N ~ (v/k, sqrt(1-v^2)) enine, + detay tilt · sqrt(1-v^2)
    vec2 grad = -N0.xy / max(N0.z, 0.2);
    vec3 N = N0;
    float vv = clamp(g0.z, -1.0, 1.0);
    if (uAnalyticN == 1) {
      float kk = texelFetch(uThreads, ivec2(pmod(idx, isWarp ? uPeriod.x : uPeriod.y), isWarp ? 0 : 4), 0).z;
      float nup = sqrt(max(1.0 - vv * vv, 0.0));
      vec2 across = (isWarp ? vec2(vv, 0.0) : vec2(0.0, vv)) / kk;
      N = normalize(vec3(across - nup * grad, max(nup, 0.02)));
    }
    vec3 V = vec3(0.0, 0.0, 1.0);
    vec3 H = normalize(L + V);
    float diff = clamp(dot(N, L) * 0.75 + 0.25, 0.0, 1.0);
    // Kajiya-Kay: teğet iplik ekseni + boyunca eğim
    vec3 Tn = normalize(isWarp ? vec3(0.0, 1.0, grad.y) : vec3(1.0, 0.0, grad.x));
    float TH = dot(Tn, H);
    float sinTH = sqrt(clamp(1.0 - TH * TH, 0.0, 1.0));
    float w = max(uSpecWidthMul, 0.05);
    // Speküler: parlaklık sınıfına göre yumuşak tavan, açık albedoda azalır → beyaz iplik yanmaz
    float specRaw = (0.05 * pow(sinTH, 12.0 / w) + 0.10 * pow(sinTH, 90.0 / w)) * uLusterMul[lusterIdx];
    float cap = lusterIdx == 0 ? 0.10 : (lusterIdx == 1 ? 0.18 : 0.32);
    float lumB = clamp(dot(base, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
    float spec = cap * (1.0 - exp(-specRaw / cap)) * uSpecMul * mix(1.0, 0.35, lumB);
    // Melanj: iplik boyunca uzamış lif gürültüsü ~ ±%4.5 (+ kat ±%3: yalnız ipucu, görünürlük ışıktan gelir)
    base *= max(0.0, 1.0 + uMelange * 0.045 * g2.z + 0.03 * (g2.x - 0.76));
    // Kavite: kat olukları ve kesit kenarı kararır
    float cav = mix(0.6, 1.0, smoothstep(0.0, 0.7, g2.x)) * (1.0 - 0.3 * pow(abs(vv), 3.0));
    vec3 top;
    if (uBg == 2) {
      top = backlitThread(base, g0.z, yt.x, diff, aoT) * cav;
    } else {
      float lightv = (0.22 * aoT + 0.95 * diff * sh * aoT) * cav;
      // kenarda hafif rim (kesit kenarında ışığı yakalayan lifler)
      top = base * lightv + spec * sh * aoT * cav + base * 0.10 * pow(abs(vv), 6.0) * diffFlat * sh;
    }
    col = mix(under, top, cov);
  }
  vec3 outS = toSrgb(tone(col * uExposure));
  // Tüylülük (D): kök renginin ışıklı hali ×1.05 + 4/255 (fix-v3: v2'de ×1.15 + 12, çizik gibiydi); arkadan
  // ışıkta lif koyu siluet
  if (hair.a > 1e-4) {
    vec3 hl = uBg == 2 ? toLinear(hair.rgb / hair.a) * 0.06 : toLinear(hair.rgb / hair.a) * lightFlat;
    outS = mix(outS, clamp(toSrgb(tone(hl * uExposure)) * 1.05 + 4.0 / 255.0, 0.0, 1.0), hair.a);
  }
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
