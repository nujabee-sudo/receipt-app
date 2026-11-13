import { expect, test } from 'vitest';
import { parseRecognition, RecognitionError } from '../../src/recognition/schema';

const item = (over: Record<string, unknown> = {}) => ({
  index: 0,
  date: '2026-09-29',
  time: '18:52',
  amount: 10000,
  cardLast4: '1234',
  merchant: '행복주유소',
  approvalNo: '12345678',
  category: 'urea',
  isCancellation: false,
  corners: [
    [100, 50],
    [900, 60],
    [880, 950],
    [120, 940],
  ],
  ...over,
});

test('valid response passes through', () => {
  const out = parseRecognition({ results: [item(), item({ index: 1, amount: 111000 })] }, 2);
  expect(out).toHaveLength(2);
  expect(out[0]).toEqual(item());
  expect(out[1].amount).toBe(111000);
});

test('accepts JSON string input', () => {
  expect(parseRecognition(JSON.stringify({ results: [item()] }), 1)[0].merchant).toBe('행복주유소');
});

test('amount string with commas becomes number', () => {
  expect(parseRecognition({ results: [item({ amount: '10,000' })] }, 1)[0].amount).toBe(10000);
});

test('malformed date and time become null', () => {
  const r = parseRecognition({ results: [item({ date: '26/09/29', time: '6pm' })] }, 1)[0];
  expect(r.date).toBeNull();
  expect(r.time).toBeNull();
});

test('unknown category becomes other', () => {
  expect(parseRecognition({ results: [item({ category: 'food' })] }, 1)[0].category).toBe('other');
});

test('cardLast4 must be 4 digits', () => {
  expect(parseRecognition({ results: [item({ cardLast4: '06**' })] }, 1)[0].cardLast4).toBeNull();
});

test('bad corners become null', () => {
  expect(parseRecognition({ results: [item({ corners: [[1, 2]] })] }, 1)[0].corners).toBeNull();
  expect(
    parseRecognition({ results: [item({ corners: [[0, 0], [2000, 0], [10, 10], [0, 10]] })] }, 1)[0].corners,
  ).toBeNull();
});

test('out-of-range index is dropped', () => {
  const out = parseRecognition({ results: [item({ index: 7 }), item({ index: 1, amount: 1 })] }, 5);
  expect(out).toHaveLength(1);
  expect(out[0]).toMatchObject({ index: 1, amount: 1 });
});

test('a repeated index in a batch means no label can be trusted, so nothing is applied', () => {
  const out = parseRecognition({ results: [0, 1, 2, 2, 3].map((index, k) => item({ index, amount: 1000 + k })) }, 5);
  expect(out).toEqual([]);
});

test('for a single image a repeated index keeps the first', () => {
  const out = parseRecognition({ results: [item({ index: 0, amount: 1 }), item({ index: 0, amount: 2 })] }, 1);
  expect(out).toHaveLength(1);
  expect(out[0].amount).toBe(1);
});

test('top-level garbage throws format error', () => {
  expect(() => parseRecognition({}, 1)).toThrow(RecognitionError);
  expect(() => parseRecognition('not json', 1)).toThrow(RecognitionError);
  try {
    parseRecognition({}, 1);
  } catch (e) {
    expect((e as RecognitionError).kind).toBe('format');
  }
});
