import type { Receipt } from '../domain/types';

export interface FileNameOpts {
  ym: string; // 'YYYY-MM'
  cardLast4: string;
  user: string;
  partial: boolean;
  receipts: Receipt[];
}

const clean = (s: string) => s.replace(/[\\/:*?"<>|]/g, '').trim();

/** `{YYYY}년 {M}월 법인카드(#{카드}) 사용내역서_{사용자}` + 일부면 `({MM.DD}~{MM.DD})` */
export function fileName(opts: FileNameOpts, ext: 'pdf' | 'xlsx'): string {
  const [y, m] = opts.ym.split('-');
  let name = `${y}년 ${Number(m)}월 법인카드(#${clean(opts.cardLast4)}) 사용내역서_${clean(opts.user)}`;
  if (opts.partial) {
    const dates = opts.receipts.map((r) => r.date).filter((d): d is string => !!d).sort();
    if (dates.length) {
      const md = (d: string) => `${d.slice(5, 7)}.${d.slice(8, 10)}`;
      name += `(${md(dates[0])}~${md(dates[dates.length - 1])})`;
    }
  }
  return `${name}.${ext}`;
}
