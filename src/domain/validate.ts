import type { Receipt } from './types';

export const W = {
  date: '일자를 확인해 주세요',
  amount: '금액을 확인해 주세요',
  card: '다른 카드 영수증일 수 있어요',
  duplicate: '중복일 수 있어요',
  site: '현장을 입력해 주세요',
  item: '항목을 입력해 주세요',
  users: '사용자를 선택해 주세요',
} as const;

function minusMonths(ymd: string, months: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const total = y * 12 + (m - 1) - months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export interface ValidateContext {
  today: string; // 'YYYY-MM-DD'
  cardLast4: string;
  others: Receipt[];
}

/** 경고 문구 배열. 빈 배열이면 통과. */
export function validateReceipt(r: Receipt, ctx: ValidateContext): string[] {
  const w: string[] = [];
  if (!r.date || r.date > ctx.today || r.date < minusMonths(ctx.today, 3)) w.push(W.date);
  if (r.amount === null || r.amount <= 0) w.push(W.amount);
  if (r.cardLast4 && ctx.cardLast4 && r.cardLast4 !== ctx.cardLast4) w.push(W.card);
  const dup = ctx.others.some(
    (o) =>
      o.id !== r.id &&
      o.status !== 'excluded' &&
      o.date !== null &&
      o.date === r.date &&
      o.amount === r.amount &&
      (o.merchant ?? '') === (r.merchant ?? ''),
  );
  if (dup) w.push(W.duplicate);
  if (!r.site.trim()) w.push(W.site);
  if (!r.item.trim()) w.push(W.item);
  if (r.users.length === 0) w.push(W.users);
  return w;
}
