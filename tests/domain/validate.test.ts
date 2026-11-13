import { expect, test } from 'vitest';
import { validateReceipt } from '../../src/domain/validate';
import { makeReceipt } from '../helpers';

const ctx = { today: '2026-11-13', cardLast4: '1234', others: [] as ReturnType<typeof makeReceipt>[] };
const full = () => makeReceipt({ date: '2026-11-01' });

test('passes a complete receipt', () => {
  expect(validateReceipt(full(), ctx)).toEqual([]);
});

test('missing date and amount', () => {
  const w = validateReceipt(makeReceipt({ date: null, amount: null }), ctx);
  expect(w).toContain('일자를 확인해 주세요');
  expect(w).toContain('금액을 확인해 주세요');
});

test('future date warns', () => {
  expect(validateReceipt(makeReceipt({ date: '2026-11-14' }), ctx)).toContain('일자를 확인해 주세요');
});

test('older than 3 months warns, exactly 3 months passes', () => {
  expect(validateReceipt(makeReceipt({ date: '2026-08-12' }), ctx)).toContain('일자를 확인해 주세요');
  expect(validateReceipt(makeReceipt({ date: '2026-08-13' }), ctx)).toEqual([]);
});

test('amount <= 0 warns', () => {
  expect(validateReceipt(makeReceipt({ date: '2026-11-01', amount: 0 }), ctx)).toContain('금액을 확인해 주세요');
});

test('different card warns', () => {
  expect(validateReceipt(makeReceipt({ date: '2026-11-01', cardLast4: '9999' }), ctx)).toContain(
    '다른 카드 영수증일 수 있어요',
  );
});

test('unknown card number does not warn', () => {
  expect(validateReceipt(makeReceipt({ date: '2026-11-01', cardLast4: null }), ctx)).toEqual([]);
});

test('duplicate warns, same id does not', () => {
  const me = full();
  const twin = makeReceipt({ id: 'r2', date: '2026-11-01' });
  expect(validateReceipt(me, { ...ctx, others: [twin] })).toContain('중복일 수 있어요');
  expect(validateReceipt(me, { ...ctx, others: [me] })).toEqual([]);
});

test('empty site, item, users warn', () => {
  const w = validateReceipt(makeReceipt({ date: '2026-11-01', site: ' ', item: '', users: [] }), ctx);
  expect(w).toEqual(['현장을 입력해 주세요', '항목을 입력해 주세요', '사용자를 선택해 주세요']);
});
