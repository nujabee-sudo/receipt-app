import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { fitText } from '../../src/export/fitText';
import { buildPdf } from '../../src/export/pdf';
import { paginate } from '../../src/layout/paginate';
import { makeReceipt } from '../helpers';

const measure = (s: string, size: number) => s.length * size * 0.6;

test('fitText keeps default size when it fits', () => {
  expect(fitText('짧은 내용', 100, measure)).toEqual({ size: 10, lines: ['짧은 내용'] });
});

test('fitText shrinks to 9pt when that fits', () => {
  const t = 'x'.repeat(18); // 10pt: 108, 9pt: 97.2
  expect(fitText(t, 100, measure)).toEqual({ size: 9, lines: [t] });
});

test('fitText shrinks then wraps', () => {
  const t = '가나테크_서울 본사, 1호기 시운전 : 주유(쏘렌토)'; // 35 chars → 8pt: 168
  const r = fitText(t, 100, measure);
  expect(r.size).toBe(8);
  expect(r.lines).toHaveLength(2);
  for (const l of r.lines) expect(measure(l, 8)).toBeLessThanOrEqual(100);
  expect(r.lines.join(' ').replace(/\s+/g, ' ')).toBe(t);
});

test('fitText breaks long words without spaces', () => {
  const r = fitText('가'.repeat(30), 100, measure);
  expect(r.lines).toHaveLength(2);
  for (const l of r.lines) expect(measure(l, 8)).toBeLessThanOrEqual(100);
});

test('fitText truncates with ellipsis beyond two lines', () => {
  const r = fitText('가 '.repeat(60).trim(), 100, measure);
  expect(r.lines).toHaveLength(2);
  expect(r.lines[1].endsWith('…')).toBe(true);
  expect(measure(r.lines[1], 8)).toBeLessThanOrEqual(100);
});

const fontDir = 'node_modules/pretendard/dist/public/static/alternative/';
const fonts = {
  regular: new Uint8Array(readFileSync(fontDir + 'Pretendard-Regular.ttf')),
  bold: new Uint8Array(readFileSync(fontDir + 'Pretendard-Bold.ttf')),
};
const jpg = new Uint8Array(readFileSync('tests/fixtures/tiny.jpg'));

test('buildPdf renders pages, A4 size, and images per page', async () => {
  const list = ['a', 'b', 'c', 'd', 'e'].map((id, i) =>
    makeReceipt({
      id,
      date: `2026-09-${String(29 - i * 3).padStart(2, '0')}`,
      users: i === 4 ? ['이영희', '김철수', '최지우', '박민수', '홍길동'] : ['김철수'],
      photos: [{ id: `${id}p`, original: null, processed: null, corners: null }],
    }),
  );
  const pages = paginate(list.map((r) => ({ id: r.id, date: r.date, photos: [{ photoId: `${r.id}p`, aspect: 3.2 }] })));
  const bytes = await buildPdf({
    pages,
    receipts: new Map(list.map((r) => [r.id, r])),
    photoBytes: new Map(list.map((r) => [`${r.id}p`, jpg])),
    fonts,
    cardFallback: '1234',
  });
  const doc = await PDFDocument.load(bytes);
  expect(doc.getPageCount()).toBe(pages.length);
  const p0 = doc.getPage(0);
  expect(p0.getWidth()).toBeCloseTo(595.28, 1);
  expect(p0.getHeight()).toBeCloseTo(841.89, 1);
  const xobj = p0.node.Resources()?.lookup(PDFName.of('XObject'), PDFDict);
  expect(xobj?.keys().length ?? 0).toBe(pages[0].photos.length);
});
