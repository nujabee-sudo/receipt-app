import type { Receipt } from './types';

/** 날짜 → 시각 순 정렬. date/time이 null인 건은 방향과 상관없이 맨 뒤. 원본 불변. */
export function sortReceipts(list: Receipt[], order: 'desc' | 'asc'): Receipt[] {
  const dir = order === 'desc' ? -1 : 1;
  const cmp = (a: string | null, b: string | null): number => {
    if (a === b) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return a < b ? -dir : dir;
  };
  return [...list].sort((a, b) => cmp(a.date, b.date) || cmp(a.time, b.time));
}
