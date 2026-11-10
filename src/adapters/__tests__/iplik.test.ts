import { describe, expect, it } from 'vitest';
import { bukumTurM, iplikOlustur, iplikToYarnType, neOf, parseNumara, sonucNumara, varsayilanTip } from '../iplik';

describe('iplik numarası', () => {
  it('"60/2 Ne" = 2 katlı, tek kat Ne 60 → sonuç Ne 30', () => {
    expect(parseNumara('60/2 Ne')).toEqual({ tekKat: 60, kat: 2, birim: 'Ne', sonuc: 30 });
    expect(parseNumara('24/1 Ne').sonuc).toBe(24);
    expect(parseNumara('10/1 ne').birim).toBe('Ne');
  });
  it('doğrudan sistemde kat numarayı büyütür; "900 denye" tek kat', () => {
    expect(parseNumara('900 denye')).toEqual({ tekKat: 900, kat: 1, birim: 'Denier', sonuc: 900 });
    expect(sonucNumara(150, 2, 'Dtex')).toBe(300);
    expect(sonucNumara(34, 2, 'Nm')).toBe(17);
  });
  it('geçersiz numara anlaşılır hata verir', () => {
    expect(() => parseNumara('Ne 60')).toThrow(/okunamadı/);
    expect(() => parseNumara('60/2 xyz')).toThrow(/birim/);
  });
  it('Ne dönüşümü: 900 denye ≈ Ne 5.9, Nm 34 ≈ Ne 20', () => {
    expect(neOf(900, 'Denier')).toBeCloseTo(5.905, 2);
    expect(neOf(34, 'Nm')).toBeCloseTo(20.08, 1);
  });
});

describe('iplik tipi ve görünüm', () => {
  it('tip birimden varsayılan: Ne / Nm eğrilmiş, Denier / Dtex filament; elle değiştirilebilir', () => {
    expect(varsayilanTip('Ne')).toBe('egrilmis');
    expect(varsayilanTip('Denier')).toBe('filament');
    expect(iplikOlustur('x', '900 denye').tip).toBe('filament');
    expect(iplikOlustur('x', '900 denye', { tip: 'teksture' }).tip).toBe('teksture');
  });
  it('büküm seviyesi → tur/m (eğrilmiş: α·√Ne·39.37); sayı verilirse aynen', () => {
    const i = iplikOlustur('x', '24/1 Ne');
    expect(bukumTurM(i)).toBeCloseTo(3.8 * Math.sqrt(24) * 39.37, 6);
    expect(bukumTurM({ ...i, bukum: 'yuksek' })).toBeGreaterThan(bukumTurM(i));
    expect(bukumTurM({ ...i, bukum: 650 })).toBe(650);
    // katlı iplikte sonuç numaradan
    expect(bukumTurM(iplikOlustur('y', '60/2 Ne'))).toBeCloseTo(3.8 * Math.sqrt(30) * 39.37, 6);
  });
  it('YarnType eşlemesi: sonuç numara, kat, yapı, parlaklık; filamentte tüy 0', () => {
    expect(iplikToYarnType(iplikOlustur('a', '60/2 Ne'))).toMatchObject({ count: 30, unit: 'Ne', plies: 2, structure: 'spun', luster: 'mat' });
    expect(iplikToYarnType(iplikOlustur('b', '10/1 Ne'))).toMatchObject({ plies: 1, structure: 'spun' });
    const f = iplikToYarnType(iplikOlustur('c', '167 dtex', { tuyluluk: 0.5 }));
    expect(f).toMatchObject({ structure: 'filament', luster: 'parlak', hairiness: 0 });
    const t = iplikToYarnType(iplikOlustur('d', '900 denye', { tip: 'teksture', parlaklik: 'mat' }));
    expect(t).toMatchObject({ count: 900, unit: 'Denier', structure: 'textured', luster: 'mat' });
  });
});
