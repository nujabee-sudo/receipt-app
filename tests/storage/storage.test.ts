import 'fake-indexeddb/auto';
import { beforeEach, expect, test } from 'vitest';
import { db } from '../../src/storage/db';
import { receipts, StorageFullError } from '../../src/storage/receipts';
import { presets } from '../../src/storage/presets';
import { settings, DEFAULT_SETTINGS } from '../../src/storage/settings';
import { makeReceipt } from '../helpers';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const photo = (id: string) => ({
  id,
  original: new Blob(['orig-bytes'], { type: 'image/jpeg' }),
  processed: new Blob(['proc'], { type: 'image/jpeg' }),
  corners: null,
});

test('put/get/remove round trip', async () => {
  await receipts.put(makeReceipt({ id: 'a' }));
  expect((await receipts.get('a'))?.merchant).toBe('행복주유소');
  await receipts.remove('a');
  expect(await receipts.get('a')).toBeUndefined();
});

test('listByMonth uses date, or createdAt when date is null', async () => {
  await receipts.put(makeReceipt({ id: 'sep', date: '2026-09-29' }));
  await receipts.put(makeReceipt({ id: 'nodate', date: null, createdAt: '2026-09-03T01:00:00.000Z' }));
  await receipts.put(makeReceipt({ id: 'oct', date: '2026-10-01' }));
  const ids = (await receipts.listByMonth('2026-09')).map((r) => r.id).sort();
  expect(ids).toEqual(['nodate', 'sep']);
});

test('listByStatus filters', async () => {
  await receipts.put(makeReceipt({ id: 'q', status: 'queued' }));
  await receipts.put(makeReceipt({ id: 'd', status: 'done' }));
  expect((await receipts.listByStatus(['queued'])).map((r) => r.id)).toEqual(['q']);
});

test('markGenerated sets only given ids', async () => {
  await receipts.put(makeReceipt({ id: 'a' }));
  await receipts.put(makeReceipt({ id: 'b' }));
  await receipts.markGenerated(['a'], '2026-10-01T00:00:00.000Z');
  expect((await receipts.get('a'))?.generatedAt).toBe('2026-10-01T00:00:00.000Z');
  expect((await receipts.get('b'))?.generatedAt).toBeNull();
});

test('purgeMonth photos keeps processed, all deletes only that month', async () => {
  await receipts.put(makeReceipt({ id: 'sep', date: '2026-09-29', photos: [photo('p1')] }));
  await receipts.put(makeReceipt({ id: 'oct', date: '2026-10-02', photos: [photo('p2')] }));
  expect(await receipts.purgeMonth('2026-09', 'photos')).toBe(1);
  const sep = await receipts.get('sep');
  expect(sep?.photos[0].original).toBeNull();
  expect(sep?.photos[0].processed).not.toBeNull();
  expect((await receipts.get('oct'))?.photos[0].original).not.toBeNull();

  expect(await receipts.purgeMonth('2026-09', 'all')).toBe(1);
  expect(await receipts.get('sep')).toBeUndefined();
  expect(await receipts.get('oct')).toBeDefined();
});

test('purgeMonth photos never deletes an original that has no processed copy', async () => {
  await receipts.put(
    makeReceipt({ id: 'only', date: '2026-09-29', photos: [{ id: 'p', original: new Blob(['o']), processed: null, corners: null }] }),
  );
  await receipts.purgeMonth('2026-09', 'photos');
  expect((await receipts.get('only'))?.photos[0].original).not.toBeNull();
});

test('QuotaExceededError becomes StorageFullError', async () => {
  const orig = db.receipts.put.bind(db.receipts);
  (db.receipts as any).put = () => Promise.reject(Object.assign(new Error('full'), { name: 'QuotaExceededError' }));
  await expect(receipts.put(makeReceipt())).rejects.toBeInstanceOf(StorageFullError);
  (db.receipts as any).put = orig;
});

test('presets.touch counts uses', async () => {
  await presets.touch('site', '현장A', '2026-11-01T00:00:00.000Z');
  await presets.touch('site', '현장A', '2026-11-02T00:00:00.000Z');
  const all = await db.presets.toArray();
  expect(all).toHaveLength(1);
  expect(all[0].useCount).toBe(2);
  expect(all[0].lastUsedAt).toBe('2026-11-02T00:00:00.000Z');
});

test('presets.list: recent 30 days first, then by useCount', async () => {
  const now = '2026-11-13T00:00:00.000Z';
  await db.presets.bulkPut([
    { kind: 'site', value: 'A', useCount: 9, lastUsedAt: '2026-10-04T00:00:00.000Z' }, // 40일 전
    { kind: 'site', value: 'B', useCount: 2, lastUsedAt: '2026-11-12T00:00:00.000Z' }, // 1일 전
    { kind: 'site', value: 'C', useCount: 5, lastUsedAt: '2026-11-10T00:00:00.000Z' }, // 3일 전
    { kind: 'user', value: '김철수', useCount: 1, lastUsedAt: now },
  ]);
  expect(await presets.list('site', now)).toEqual(['C', 'B', 'A']);
});

test('presets.touch ignores blank values', async () => {
  await presets.touch('user', '  ', '2026-11-01T00:00:00.000Z');
  expect(await db.presets.count()).toBe(0);
});

test('settings defaults and partial save', async () => {
  expect(await settings.get()).toEqual(DEFAULT_SETTINGS);
  await settings.save({ cardLast4: '1234' });
  await settings.save({ defaultUser: '김철수' });
  const s = await settings.get();
  expect(s.cardLast4).toBe('1234');
  expect(s.defaultUser).toBe('김철수');
  expect(s.sortOrder).toBe('desc');
});
