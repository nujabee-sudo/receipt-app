import { expect, test } from 'vitest';
import { DEFAULT_SPEC, paginate, photoArea, type LayoutReceipt, type Page } from '../../src/layout/paginate';

const rc = (id: string, date: string | null, aspects: number[]): LayoutReceipt => ({
  id,
  date,
  photos: aspects.map((aspect, i) => ({ photoId: `${id}-p${i}`, aspect })),
});

const pageOf = (pages: Page[], receiptId: string) => pages.findIndex((p) => p.receiptIds.includes(receiptId));

function expectPageComplete(pages: Page[]) {
  for (const p of pages) {
    const withPhotos = new Set(p.photos.map((x) => x.receiptId));
    for (const id of withPhotos) expect(p.receiptIds).toContain(id);
  }
}

function expectInBounds(pages: Page[]) {
  const s = DEFAULT_SPEC;
  for (const p of pages)
    for (const ph of p.photos) {
      expect(ph.x).toBeGreaterThanOrEqual(s.marginX - 1e-6);
      expect(ph.x + ph.w).toBeLessThanOrEqual(s.pageW - s.marginX + 1e-6);
      expect(ph.y + ph.h).toBeLessThanOrEqual(s.pageH - s.marginBottom + 1e-6);
    }
}

test('photoArea matches spec numbers', () => {
  expect(photoArea(1)).toBeCloseTo(246 - 18 - 8);
  expect(photoArea(2)).toBeCloseTo(246 - 36 - 8);
});

test('two receipts same day fit one page', () => {
  const pages = paginate([rc('a', '2026-09-29', [2]), rc('b', '2026-09-29', [2])]);
  expect(pages).toHaveLength(1);
  expect(pages[0].receiptIds).toEqual(['a', 'b']);
  expect(pages[0].photos).toHaveLength(2);
  expect(pages[0].tableTop).toBeCloseTo(36);
});

test('small days merge onto one page', () => {
  const pages = paginate([rc('a', '2026-09-29', [2]), rc('b', '2026-09-21', [2])]);
  expect(pages).toHaveLength(1);
});

test('four short photos 2x2', () => {
  const pages = paginate(['a', 'b', 'c', 'd'].map((id) => rc(id, '2026-09-17', [1])));
  expect(pages).toHaveLength(1);
  const ys = new Set(pages[0].photos.map((p) => p.y.toFixed(3)));
  expect(ys.size).toBe(2);
  const xs = new Set(pages[0].photos.map((p) => (p.x < 105 ? 'L' : 'R')));
  expect(xs).toEqual(new Set(['L', 'R']));
});

test('day too big splits by receipt and pages stay complete', () => {
  const pages = paginate(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => rc(id, '2026-09-14', [2])));
  expect(pages.length).toBeGreaterThanOrEqual(2);
  expect(pages.flatMap((p) => p.receiptIds)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  expectPageComplete(pages);
});

test('a day does not get split when it can start a fresh page', () => {
  const pages = paginate([
    rc('x', '2026-09-30', [3.2]),
    rc('a', '2026-09-29', [2]),
    rc('b', '2026-09-29', [2]),
  ]);
  expect(pageOf(pages, 'a')).toBe(pageOf(pages, 'b'));
});

test('multi-photo receipt stays together on one page', () => {
  const pages = paginate([rc('a', '2026-09-01', [2]), rc('m', '2026-09-01', [1.5, 1.5, 1.5])]);
  const ph = pages.flatMap((p, i) => p.photos.filter((x) => x.receiptId === 'm').map(() => i));
  expect(ph).toHaveLength(3);
  expect(new Set(ph).size).toBe(1);
});

test('respects minimum photo width', () => {
  const pages = paginate(['a', 'b', 'c', 'd', 'e'].map((id) => rc(id, '2026-09-10', [3.5])));
  for (const p of pages) for (const ph of p.photos) expect(ph.w).toBeGreaterThanOrEqual(45 - 1e-6);
});

test('test_extremely_tall_photo_gets_own_page', () => {
  const pages = paginate([rc('long', '2026-09-17', [9]), rc('n', '2026-09-17', [2])]);
  const i = pageOf(pages, 'long');
  expect(pages[i].receiptIds).toEqual(['long']);
  const ph = pages[i].photos[0];
  expect(ph.h).toBeLessThanOrEqual(photoArea(1) + 1e-6);
  expectInBounds(pages);
});

test('receipt without photos still appears in a table', () => {
  const pages = paginate([rc('a', '2026-09-01', [])]);
  expect(pages).toHaveLength(1);
  expect(pages[0].receiptIds).toEqual(['a']);
  expect(pages[0].photos).toHaveLength(0);
});

test('null-date receipts are grouped and placed', () => {
  const pages = paginate([rc('a', '2026-09-01', [2]), rc('n1', null, [2]), rc('n2', null, [2])]);
  expect(pages.flatMap((p) => p.receiptIds)).toEqual(['a', 'n1', 'n2']);
});

test('no photo overflows page (seeded random)', () => {
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const list = Array.from({ length: 30 }, (_, i) =>
    rc(`r${i}`, `2026-09-${String(30 - Math.floor(i / 3)).padStart(2, '0')}`, [0.5 + rand() * 3.5]),
  );
  const pages = paginate(list);
  expect(pages.flatMap((p) => p.receiptIds)).toEqual(list.map((r) => r.id));
  expectInBounds(pages);
  expectPageComplete(pages);
});
