import { describe, expect, it } from 'vitest';
import { alongWave, crossProfile, ply, pmod, smoothstep, warpSign, weftSign } from '../heightfield/wave';
import { gaussianBlur, gaussianKernel } from '../heightfield/gaussian';
import { constantRandomSource } from '../heightfield/random';
import { renderHeightfield } from '../heightfield/render';
import { DEFAULT_PARAMS } from '../types';

describe('smoothstep', () => {
  it('uçlarda 0 ve 1, ortada 0.5, monoton', () => {
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(1)).toBe(1);
    expect(smoothstep(0.5)).toBe(0.5);
    let prev = -1;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const v = smoothstep(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
  it('uçlarda eğim 0 (yumuşak geçiş)', () => {
    const e = 1e-4;
    expect(smoothstep(e) / e).toBeLessThan(0.01);
    expect((1 - smoothstep(1 - e)) / e).toBeLessThan(0.01);
  });
});

describe('bağlantı işaretleri', () => {
  // 2×2 matris: satır 0 (alt) = [true, false], satır 1 = [false, true]
  const M = [
    [true, false],
    [false, true],
  ];
  it('çözgüde true → +1, false → −1', () => {
    expect(warpSign(M, 0, 0)).toBe(1);
    expect(warpSign(M, 0, 1)).toBe(-1);
  });
  it('atkıda işaret terstir', () => {
    expect(weftSign(M, 0, 0)).toBe(-1);
    expect(weftSign(M, 0, 1)).toBe(1);
  });
  it('rapor dışı indeksler Python % gibi sarılır', () => {
    expect(pmod(-1, 4)).toBe(3);
    expect(warpSign(M, -1, -1)).toBe(warpSign(M, 1, 1));
    expect(warpSign(M, 2, 3)).toBe(warpSign(M, 0, 1));
  });
});

describe('alongWave', () => {
  const cell = 10;
  const states = [1, -1, 1, 1];
  const at = (k: number) => states[pmod(k, states.length)];
  it('hücre merkezlerinde tam ±1', () => {
    expect(alongWave(5, cell, at)).toBeCloseTo(1, 12); // hücre 0 merkezi
    expect(alongWave(15, cell, at)).toBeCloseTo(-1, 12); // hücre 1 merkezi
    expect(alongWave(35, cell, at)).toBeCloseTo(1, 12);
  });
  it('iki hücre arasında smoothstep geçişi (ortada 0)', () => {
    expect(alongWave(10, cell, at)).toBeCloseTo(0, 12);
    const quarter = alongWave(7.5, cell, at); // f = smoothstep(0.25) = 0.15625
    expect(quarter).toBeCloseTo(1 * (1 - 0.15625) + -1 * 0.15625, 12);
  });
  it('aynı işaretli komşular arasında düz kalır (flotte)', () => {
    for (let p = 25; p <= 35; p += 1) expect(alongWave(p, cell, at)).toBeCloseTo(1, 12);
  });
});

describe('kesit profili ve büküm', () => {
  it('merkezde 0.6r, kenarda 0', () => {
    expect(crossProfile(0, 10)).toBeCloseTo(6, 12);
    expect(crossProfile(10, 10)).toBe(0);
    expect(crossProfile(15, 10)).toBe(0);
  });
  it('büküm 0..1 aralığında, oluk ve sırt verir', () => {
    expect(ply(0, 0, 10, 0.65, 20)).toBe(0);
    expect(ply(10, 0, 10, 0.65, 20)).toBeCloseTo(1, 12);
  });
});

describe('gaussian (scipy uyumlu)', () => {
  it('çekirdek yarıçapı int(4σ+0.5) ve toplam 1', () => {
    expect(gaussianKernel(0.7).length).toBe(2 * 3 + 1);
    expect(gaussianKernel(4).length).toBe(2 * 16 + 1);
    const k = gaussianKernel(1.2);
    expect(k.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });
  it('sabit görüntüyü değiştirmez (reflect kenar)', () => {
    const a = new Float32Array(30).fill(2.5);
    const b = gaussianBlur(a, 6, 5, 4);
    for (const v of b) expect(v).toBeCloseTo(2.5, 5);
  });
});

describe('render yönü: satırlar alttan yukarı', () => {
  it('0. atkı görüntünün en altında', () => {
    // 1 çözgü × 2 atkı: atkı 0 kırmızı, atkı 1 mavi; çözgü hep altta (false)
    const img = renderHeightfield(
      {
        weave: [[false], [false]],
        warpColors: ['#00ff00'],
        weftColors: ['#ff0000', '#0000ff'],
        nWarp: 1,
        nWeft: 2,
      },
      { ...DEFAULT_PARAMS, cell: 20, wobble: 0 },
      { random: constantRandomSource() },
    );
    const px = (x: number, y: number) => {
      const o = (y * img.width + x) * 4;
      return [img.data[o], img.data[o + 1], img.data[o + 2]];
    };
    const bottom = px(10, 30); // alt yarının ortası
    const top = px(10, 10); // üst yarının ortası
    expect(bottom[0]).toBeGreaterThan(bottom[2]); // kırmızı baskın
    expect(top[2]).toBeGreaterThan(top[0]); // mavi baskın
  });

  it('bölge render tam render ile iç bölgede aynı', () => {
    const input = {
      weave: [
        [true, false, false, false],
        [false, true, false, false],
        [false, false, true, false],
        [false, false, false, true],
      ],
      warpColors: ['#3fc0d2'],
      weftColors: ['#4a5058'],
      nWarp: 12,
      nWeft: 12,
    };
    const p = { ...DEFAULT_PARAMS, cell: 16 };
    const full = renderHeightfield(input, p);
    const region = { x: 60, y: 50, width: 40, height: 30 };
    const part = renderHeightfield(input, p, { region });
    let maxDiff = 0;
    for (let y = 0; y < region.height; y++) {
      for (let x = 0; x < region.width; x++) {
        for (let c = 0; c < 3; c++) {
          const a = full.data[((y + region.y) * full.width + x + region.x) * 4 + c];
          const b = part.data[(y * part.width + x) * 4 + c];
          maxDiff = Math.max(maxDiff, Math.abs(a - b));
        }
      }
    }
    expect(maxDiff).toBeLessThanOrEqual(2);
  });
});
