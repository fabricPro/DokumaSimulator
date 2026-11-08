/**
 * Taraklama raporu metin sözdizimi.
 *
 *   "3-0"              → [3,0]
 *   "3-3-3-0-0"        → [3,3,3,0,0]
 *   "3x4, 0x2"         → [3,3,3,3,0,0]      (4 diş 3'lü, 2 boş diş)
 *   "(2-2-3)x2, 0"     → [2,2,3,2,2,3,0]    (grup tekrarı; iç içe olabilir)
 *
 * Ayırıcılar: '-', ',' ve ';' (boşluk yok sayılır, ayırıcı değildir). Tekrar işareti: 'x', 'X', '×', '*'.
 * Hatalı girişte tahmin yürütülmez; Türkçe hata ve konum döner.
 */

export type ParseResult = { ok: true; report: number[] } | { ok: false; error: string; position: number };

export const MAX_DENTS = 2000;

class ParseError extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(message);
  }
}

type Tok = { t: 'num'; v: number; pos: number } | { t: 'x' | '(' | ')' | 'sep'; pos: number };

function tokenize(s: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '-' || ch === ',' || ch === ';') {
      out.push({ t: 'sep', pos: i });
      i++;
      continue;
    }
    if (ch === 'x' || ch === 'X' || ch === '×' || ch === '*') {
      out.push({ t: 'x', pos: i });
      i++;
      continue;
    }
    if (ch === '(' || ch === ')') {
      out.push({ t: ch, pos: i });
      i++;
      continue;
    }
    if (/\d/.test(ch)) {
      let j = i;
      while (j < s.length && /\d/.test(s[j])) j++;
      if (s[j] === '.') throw new ParseError(`${i + 1}. karakterde ondalıklı sayı: tel sayısı tam sayı olmalı.`, i);
      out.push({ t: 'num', v: parseInt(s.slice(i, j), 10), pos: i });
      i = j;
      continue;
    }
    throw new ParseError(`${i + 1}. karakterde tanınmayan işaret: "${ch}".`, i);
  }
  return out;
}

/**
 * Dilbilgisi:
 *   liste  := öğe (sep* öğe)*
 *   öğe    := birim ('x' sayı)?
 *   birim  := sayı | '(' liste ')'
 * Not: '-' ayırıcıdır; "-3" gibi negatif sayı, öğe beklenirken gelen ayırıcı olarak hata verir.
 */
export function parseDenting(text: string): ParseResult {
  const src = text ?? '';
  if (src.trim() === '') return { ok: false, error: 'Taraklama raporu boş.', position: 0 };
  try {
    const toks = tokenize(src);
    let k = 0;
    const peek = () => toks[k];

    const parseList = (closing: boolean): number[] => {
      const out: number[] = [];
      let expectItem = true;
      while (k < toks.length) {
        const t = peek();
        if (t.t === ')') {
          if (!closing) throw new ParseError(`${t.pos + 1}. karakterde açılmamış parantez kapanıyor.`, t.pos);
          if (expectItem && out.length === 0) throw new ParseError(`${t.pos + 1}. karakterde boş grup "()".`, t.pos);
          if (expectItem) throw new ParseError(`${t.pos + 1}. karakterden önce ayırıcıdan sonra değer yok.`, t.pos);
          break;
        }
        if (t.t === 'sep') {
          if (expectItem) {
            // Başta ya da art arda ayırıcı: '-' ise negatif değer, değilse boş öğe
            if (src[t.pos] === '-' && toks[k + 1]?.t === 'num') {
              throw new ParseError(`${t.pos + 1}. karakterde negatif değer: tel sayısı 0 ya da pozitif olmalı.`, t.pos);
            }
            throw new ParseError(`${t.pos + 1}. karakterde ayırıcıdan önce değer yok.`, t.pos);
          }
          k++;
          expectItem = true;
          continue;
        }
        if (!expectItem) throw new ParseError(`${t.pos + 1}. karakterde ayırıcı bekleniyordu ("-" veya ",").`, t.pos);
        out.push(...parseItem());
        if (out.length > MAX_DENTS) throw new ParseError(`Rapor ${MAX_DENTS} dişi aşıyor.`, t.pos);
        expectItem = false;
      }
      if (k >= toks.length && expectItem && out.length > 0) {
        throw new ParseError('Rapor ayırıcıyla bitiyor; son değer eksik.', src.length - 1);
      }
      return out;
    };

    const parseItem = (): number[] => {
      const t = peek();
      let unit: number[];
      if (t.t === 'num') {
        unit = [t.v];
        k++;
      } else if (t.t === '(') {
        k++;
        unit = parseList(true);
        const c = peek();
        if (!c || c.t !== ')') throw new ParseError(`${t.pos + 1}. karakterde açılan parantez kapanmamış.`, t.pos);
        k++;
      } else if (t.t === 'x') {
        throw new ParseError(`${t.pos + 1}. karakterde tekrar işaretinden önce tel sayısı ya da grup yok.`, t.pos);
      } else {
        throw new ParseError(`${t.pos + 1}. karakterde beklenmeyen işaret.`, t.pos);
      }
      const x = peek();
      if (x && x.t === 'x') {
        k++;
        const n = peek();
        if (!n || n.t !== 'num') throw new ParseError(`${x.pos + 1}. karakterden sonra tekrar sayısı eksik.`, x.pos);
        if (n.v < 1) throw new ParseError(`${n.pos + 1}. karakterde tekrar sayısı en az 1 olmalı.`, n.pos);
        k++;
        if (unit.length * n.v > MAX_DENTS) throw new ParseError(`Rapor ${MAX_DENTS} dişi aşıyor.`, n.pos);
        const rep: number[] = [];
        for (let i = 0; i < n.v; i++) rep.push(...unit);
        unit = rep;
      }
      return unit;
    };

    const report = parseList(false);
    if (k < toks.length) {
      const t = toks[k];
      throw new ParseError(`${t.pos + 1}. karakterde açılmamış parantez kapanıyor.`, t.pos);
    }
    if (report.length === 0) return { ok: false, error: 'Taraklama raporu boş.', position: 0 };
    if (!report.some((n) => n > 0)) return { ok: false, error: 'Raporda en az bir dişte tel olmalı (hepsi boş diş).', position: 0 };
    return { ok: true, report };
  } catch (e) {
    if (e instanceof ParseError) return { ok: false, error: e.message, position: e.position };
    throw e;
  }
}

/** Raporu okunur metne çevirir; ardışık aynı değerleri "3x4" biçiminde sıkıştırır. */
export function formatDenting(report: number[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < report.length) {
    let j = i;
    while (j < report.length && report[j] === report[i]) j++;
    const n = j - i;
    if (n >= 3) parts.push(`${report[i]}x${n}`);
    else for (let t = 0; t < n; t++) parts.push(String(report[i]));
    i = j;
  }
  return parts.join('-');
}
