import { expect, test } from 'vitest';
import { composeContent, suggestItem } from '../../src/domain/content';
import type { Category } from '../../src/domain/types';

test('composeContent joins site and item', () => {
  expect(composeContent('가나테크_서울 본사, 1호기 시운전', '주유(쏘렌토)')).toBe(
    '가나테크_서울 본사, 1호기 시운전 : 주유(쏘렌토)',
  );
});

test('composeContent with empty item shows site only', () => {
  expect(composeContent('현장A', '')).toBe('현장A');
});

test.each([
  ['fuel', '18:02', '주유(쏘렌토)'],
  ['urea', '18:51', '요소수(쏘렌토)'],
  ['meal', '10:29', '조식'],
  ['meal', '10:30', '중식'],
  ['meal', '15:59', '중식'],
  ['meal', '16:00', '석식'],
  ['meal', null, '중식'],
  ['parking', '09:00', '주차'],
  ['toll', '09:00', '통행료'],
  ['lodging', '09:00', '숙박'],
  ['pharmacy', '09:00', '약품'],
  ['convenience', '09:00', '편의점'],
  ['material', '09:00', '자재 구매'],
  ['other', '09:00', ''],
])('suggestItem %s %s → %s', (c, t, exp) => {
  expect(suggestItem(c as Category, t, '쏘렌토')).toBe(exp);
});

test('fuel without vehicle has no parentheses', () => {
  expect(suggestItem('fuel', '18:00', '')).toBe('주유');
});
