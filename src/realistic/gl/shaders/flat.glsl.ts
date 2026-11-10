/**
 * Faz 1 geçişi: her pikselde örgü matrisinden üstteki ipliği bulur ve rengini düz çizer.
 * Amaç matris → doku → modulo zincirinin doğrulanması. CPU ikizi: scale.ts `flatColorAt`.
 * Sonraki fazlarda G-buffer geçişi bunun yerini alır; hücre bulma mantığı aynı kalır.
 */

/** Tam ekran üçgen (öznitelik gerektirmez). */
export const FULLSCREEN_VS = /* glsl */ `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

/**
 * Kumaş ölçeğinde doğal düzensizlik (alan bükümü; yalnız ekran geçişlerinde, pişirmede değil). Kumaş koordinatı
 * bükülür, tüm geçişler (geometri, ao / gölge döşemesi, ön süzülmüş renk) aynı bükülmüş noktadan okur → tutarlı.
 * Dalga boyları rapordan bağımsız ve uzun (37–213 mm, birbiriyle ölçülemez oranlarda): rapor tekrarında aynı kusur
 * birebir tekrar etmez.
 *  - atkı sıklığı dalgalanması (barre): dy'/dy = 1 + A·Σ wₖ·cos(2πy/Lₖ + φₖ), A = uFab.x (±%2.5 varsayılan);
 *  - çözgü sapması: x kayması y'nin yavaş fonksiyonu, genlik uFab.y mm (0.12 varsayılan; λ 127 / 53 mm);
 *  - atkı yayı: y kayması x'in yavaş fonksiyonu, genlik uFab.z mm (0.10 varsayılan; λ 151 mm).
 * VARSAYIM (kalibre edilecek): genlikler ve dalga boyları gözle seçildi. uFab = 0 → kapalı.
 */
export const FABRIC_WARP_GLSL = /* glsl */ `
uniform vec3 uFab;
uniform vec3 uFabPhA;
uniform vec3 uFabPhB;
vec2 fabricWarp(vec2 mm) {
  if (uFab.x == 0.0 && uFab.y == 0.0 && uFab.z == 0.0) return mm;
  const float TAU = 6.2831853;
  const vec3 LB = vec3(37.3, 91.7, 213.1);
  const vec3 WB = vec3(0.5, 0.33, 0.17);
  float dy = 0.0;
  for (int k = 0; k < 3; k++) dy += uFab.x * WB[k] * LB[k] / TAU * sin(TAU * mm.y / LB[k] + uFabPhA[k]);
  float dx = uFab.y * (0.7 * sin(TAU * mm.y / 127.0 + uFabPhB.x) + 0.3 * sin(TAU * mm.y / 53.0 + uFabPhB.y));
  dy += uFab.z * sin(TAU * mm.x / 151.0 + uFabPhB.z);
  return vec2(mm.x + dx, mm.y + dy);
}
`;

/** Ortak: pozitif mod ve piksel → mm. */
export const COMMON_GLSL = /* glsl */ `
// GLSL ES'te negatif tamsayı bölümü/kalanı tanımsız: taban bölmeyi float ile yap.
int pmod(int a, int n) { int r = a - n * int(floor(float(a) / float(n))); return r < 0 ? r + n : (r >= n ? r - n : r); }
`;

export const FLAT_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;

uniform usampler2D uWeave;      // R8UI, (rapor çözgü) × (rapor atkı)
uniform sampler2D uWarpColor;   // RGBA8, nWarp × 1
uniform sampler2D uWeftColor;   // RGBA8, nWeft × 1
uniform ivec2 uWeaveSize;
uniform int uWarpCount;
uniform int uWeftCount;
uniform vec2 uPitchMm;          // (çözgü aralığı, atkı aralığı)
uniform vec2 uOffsetMm;         // canvas sol altının kumaştaki konumu
uniform float uPxPerMm;

out vec4 outColor;
${COMMON_GLSL}
void main() {
  // gl_FragCoord piksel merkezidir (px + 0.5); kumaş y'si GL gibi alttan yukarı.
  vec2 mm = uOffsetMm + (gl_FragCoord.xy - 0.5) / uPxPerMm;
  int i = int(floor(mm.x / uPitchMm.x));
  int j = int(floor(mm.y / uPitchMm.y));
  uint up = texelFetch(uWeave, ivec2(pmod(i, uWeaveSize.x), pmod(j, uWeaveSize.y)), 0).r;
  outColor = up == 1u
    ? texelFetch(uWarpColor, ivec2(pmod(i, uWarpCount), 0), 0)
    : texelFetch(uWeftColor, ivec2(pmod(j, uWeftCount), 0), 0);
}
`;
