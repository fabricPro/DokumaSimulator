/**
 * WebGL2 yardımcıları: destek kontrolü, program, doku. DOM state'i kullanmaz; yalnız verilen canvas.
 */

export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

let supportCache: boolean | null = null;

/** Gerekli eklentiler: G-buffer'a float yazmak için EXT_color_buffer_float (yoksa half_float). */
export function hasRequiredExtensions(gl: WebGL2RenderingContext): { float: boolean; halfFloat: boolean } {
  return {
    float: !!gl.getExtension('EXT_color_buffer_float'),
    halfFloat: !!gl.getExtension('EXT_color_buffer_half_float'),
  };
}

/**
 * WebGL2 ve float render hedefi desteği var mı. Geçici bir canvas ile bir kez denenir.
 * OffscreenCanvas varsa o kullanılır; yoksa geçici bir <canvas> oluşturulur (sayfaya eklenmez).
 */
export function isRealisticSupported(): boolean {
  if (supportCache !== null) return supportCache;
  try {
    let canvas: AnyCanvas | null = null;
    if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(4, 4);
    else if (typeof document !== 'undefined') canvas = document.createElement('canvas');
    if (!canvas) return (supportCache = false);
    const gl = canvas.getContext('webgl2') as WebGL2RenderingContext | null;
    if (!gl) return (supportCache = false);
    const ext = hasRequiredExtensions(gl);
    supportCache = ext.float || ext.halfFloat;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    supportCache = false;
  }
  return supportCache;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('Shader derlenemedi: ' + log);
  }
  return sh;
}

export function createProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  const v = compile(gl, gl.VERTEX_SHADER, vs);
  const f = compile(gl, gl.FRAGMENT_SHADER, fs);
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error('Program bağlanamadı: ' + log);
  }
  return p;
}

/** NEAREST filtreli 2B doku (tamsayı ve 8-bit dokular için). */
export function createTexture(
  gl: WebGL2RenderingContext,
  internalFormat: number,
  width: number,
  height: number,
  format: number,
  type: number,
  data: ArrayBufferView | null,
): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
