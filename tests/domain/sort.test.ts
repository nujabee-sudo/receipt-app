import { expect, test } from 'vitest';
import { sortReceipts } from '../../src/domain/sort';
import { makeReceipt } from '../helpers';

const r = (id: string, date: string | null, time: string | null) => makeReceipt({ id, date, time });
const input = () => [
  r('a', '2026-09-21', '11:46'),
  r('b', '2026-09-29', '13:00'),
  r('c', null, null),
  r('d', '2026-09-29', '18:51'),
  r('e', '2026-09-29', null),
];

test('sorts desc by date then time, nulls last', () => {
  expect(sortReceipts(input(), 'desc').map((x) => x.id)).toEqual(['d', 'b', 'e', 'a', 'c']);
});

test('asc keeps nulls last', () => {
  expect(sortReceipts(input(), 'asc').map((x) => x.id)).toEqual(['a', 'b', 'd', 'e', 'c']);
});

test('does not mutate input', () => {
  const list = input();
  sortReceipts(list, 'desc');
  expect(list.map((x) => x.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
});
