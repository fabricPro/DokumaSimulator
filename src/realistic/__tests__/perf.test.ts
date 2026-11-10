import { describe, expect, it } from 'vitest';
import { FRAME_BUDGET_MS, initialAutoQuality, PERF_LADDER, stepAutoQuality } from '../perf';

describe('otomatik kalite merdiveni', () => {
  it('önce örnekler, sonra çözünürlük düşer', () => {
    expect(PERF_LADDER[0]).toEqual({ quality: 'high', scale: 1 });
    const firstScaleDrop = PERF_LADDER.findIndex((l) => l.scale < 1);
    expect(PERF_LADDER[firstScaleDrop - 1].quality).toBe('low');
  });
  it('bütçe aşılınca iner, yarısının altında çıkar, arada sabit', () => {
    let s = initialAutoQuality();
    s = stepAutoQuality(s, 30);
    expect(s.level).toBe(1);
    s = stepAutoQuality(s, 12); // 8..16 arası: sabit
    expect(s.level).toBe(1);
    s = stepAutoQuality(s, 3);
    s = stepAutoQuality(s, 3);
    expect(s.level).toBe(0);
  });
  it('en alt / en üst basamakta durur', () => {
    let s = initialAutoQuality(PERF_LADDER.length - 1);
    s = stepAutoQuality(s, 500);
    expect(s.level).toBe(PERF_LADDER.length - 1);
    s = initialAutoQuality(0);
    s = stepAutoQuality(s, 0.1);
    expect(s.level).toBe(0);
  });
  it('tek bir sıçrama ortalamayla yumuşar (titreşmez)', () => {
    let s = initialAutoQuality(2);
    s = stepAutoQuality(s, 10);
    s = stepAutoQuality(s, 20); // ortalama 15 < 16
    expect(s.level).toBe(2);
    expect(s.avgMs).toBeCloseTo(15, 9);
  });
  it('geçersiz ölçüm yok sayılır', () => {
    const s = initialAutoQuality(1);
    expect(stepAutoQuality(s, NaN)).toBe(s);
    expect(stepAutoQuality(s, -1)).toBe(s);
    expect(FRAME_BUDGET_MS).toBe(16);
  });
});
