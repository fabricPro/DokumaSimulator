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
