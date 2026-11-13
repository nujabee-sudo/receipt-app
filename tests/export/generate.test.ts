import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { generateDocs, selectTargets } from '../../src/export/generate';
import { DEFAULT_SETTINGS } from '../../src/storage/settings';
import { makeReceipt } from '../helpers';

const jpg = new Uint8Array(readFileSync('tests/fixtures/tiny.jpg'));
const fontDir = 'node_modules/pretendard/dist/public/static/alternative/';
const deps = {
  fonts: async () => ({ regular: new Uint8Array(readFileSync(fontDir + 'Pretendard-Regular.ttf')) }),
  aspect: async (b: Blob) => {
    if (b.size < 10) throw new Error('decode');
    return 2;
  },
};
const settings = { ...DEFAULT_SETTINGS, cardLast4: '1234', defaultUser: '김철수' };
const photo = (id: string, bytes: Uint8Array = jpg) => ({
  id,
  original: null,
  processed: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }),
  corners: null,
});

test('month mode drops only excluded receipts', () => {
  const all = [
    makeReceipt({ id: 'a', status: 'done', generatedAt: '2026-10-01T00:00:00Z' }),
    makeReceipt({ id: 'b', status: 'excluded' }),
    makeReceipt({ id: 'c', status: 'needs_review' }),
  ];
  const { targets, unresolved } = selectTargets(all, 'month');
  expect(targets.map((r) => r.id).sort()).toEqual(['a', 'c']);
  expect(unresolved.map((r) => r.id)).toEqual(['c']);
});

test('pending mode drops receipts already generated', () => {
  const all = [
    makeReceipt({ id: 'a', status: 'done', generatedAt: '2026-10-01T00:00:00Z' }),
    makeReceipt({ id: 'b', status: 'done' }),
    makeReceipt({ id: 'c', status: 'queued' }),
    makeReceipt({ id: 'd', status: 'recognizing' }),
    makeReceipt({ id: 'e', status: 'excluded' }),
  ];
  const { targets, unresolved } = selectTargets(all, 'pending');
  expect(targets.map((r) => r.id).sort()).toEqual(['b', 'c', 'd']);
  expect(unresolved.map((r) => r.id).sort()).toEqual(['c', 'd']);
});

test('generateDocs builds a pdf and xlsx with the spec file names', async () => {
  const list = [
    makeReceipt({ id: 'a', date: '2026-09-03', photos: [photo('ap')] }),
    makeReceipt({ id: 'b', date: '2026-09-21', photos: [photo('bp')] }),
  ];
  const full = await generateDocs(list, { ym: '2026-09', settings, partial: false }, deps);
  expect(full.pdf.name).toBe('2026년 9월 법인카드(#1234) 사용내역서_김철수.pdf');
  expect(full.xlsx.name).toBe('2026년 9월 법인카드(#1234) 사용내역서_김철수.xlsx');
  expect(full.pdf.blob.type).toBe('application/pdf');
  const head = new TextDecoder().decode(new Uint8Array(await full.pdf.blob.arrayBuffer()).slice(0, 5));
  expect(head).toBe('%PDF-');
  const part = await generateDocs(list, { ym: '2026-09', settings, partial: true }, deps);
  expect(part.pdf.name).toBe('2026년 9월 법인카드(#1234) 사용내역서_김철수(09.03~09.21).pdf');
});

test('an undecodable or missing photo is skipped instead of failing the document', async () => {
  const list = [
    makeReceipt({ id: 'a', photos: [photo('bad', new Uint8Array([1, 2, 3]))] }),
    makeReceipt({ id: 'b', amount: 2000, photos: [{ id: 'gone', original: null, processed: null, corners: null }] }),
    makeReceipt({ id: 'c', amount: 3000, photos: [photo('ok')] }),
  ];
  const out = await generateDocs(list, { ym: '2026-09', settings, partial: false }, deps);
  expect(out.pdf.blob.size).toBeGreaterThan(1000);
  expect(out.skippedPhotos).toBe(2);
});
