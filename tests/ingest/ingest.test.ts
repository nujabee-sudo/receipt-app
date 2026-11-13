import 'fake-indexeddb/auto';
import { beforeEach, expect, test } from 'vitest';
import { db } from '../../src/storage/db';
import { receipts } from '../../src/storage/receipts';
import { presets } from '../../src/storage/presets';
import { settings } from '../../src/storage/settings';
import { confirmReceipt, ingestFiles, nextToReview } from '../../src/ingest/ingest';
import { DecodeError } from '../../src/imaging/errors';
import { makeReceipt } from '../helpers';

beforeEach(async () => {
  await db.delete();
  await db.open();
  await settings.save({ cardLast4: '1234' });
});

const file = (name: string) => new File([name], name, { type: 'image/jpeg' });
const resize = async (b: Blob) => {
  if ((b as File).name === 'broken.heic') throw new DecodeError();
  return new Blob(['resized:' + (b as File).name], { type: 'image/jpeg' });
};

test('ingest skips undecodable file with message', async () => {
  const res = await ingestFiles([file('a.jpg'), file('broken.heic'), file('b.jpg')], {
    site: '현장A',
    defaultUser: '김철수',
    resize,
  });
  expect(res.added).toHaveLength(2);
  expect(res.failed).toEqual([{ name: 'broken.heic', message: '열 수 없는 사진이에요' }]);
});

test('ingested receipt is queued with site, default user and resized original', async () => {
  const { added } = await ingestFiles([file('a.jpg')], { site: '현장A', defaultUser: '김철수', resize });
  const r = (await receipts.get(added[0]))!;
  expect(r.status).toBe('queued');
  expect(r.site).toBe('현장A');
  expect(r.users).toEqual(['김철수']);
  expect(r.item).toBe('');
  expect(r.amount).toBeNull();
  expect(await r.photos[0].original!.text()).toBe('resized:a.jpg');
  expect(r.photos[0].processed).toBeNull();
  expect(await presets.list('site', new Date().toISOString())).toEqual(['현장A']);
});

test('empty default user gives empty users', async () => {
  const { added } = await ingestFiles([file('a.jpg')], { site: '', defaultUser: '', resize });
  expect((await receipts.get(added[0]))!.users).toEqual([]);
});

test('confirmReceipt returns warnings and keeps status when invalid', async () => {
  await receipts.put(makeReceipt({ id: 'a', date: new Date().toISOString().slice(0, 10), site: '' }));
  const res = await confirmReceipt('a');
  expect(res.ok).toBe(false);
  expect(res.warnings).toContain('현장을 입력해 주세요');
  expect((await receipts.get('a'))!.status).toBe('needs_review');
});

test('confirmReceipt marks done and records presets', async () => {
  await receipts.put(makeReceipt({ id: 'a', date: new Date().toISOString().slice(0, 10) }));
  const res = await confirmReceipt('a');
  expect(res).toEqual({ ok: true, warnings: [] });
  expect((await receipts.get('a'))!.status).toBe('done');
  const now = new Date().toISOString();
  expect(await presets.list('item', now)).toEqual(['요소수(쏘렌토)']);
  expect(await presets.list('user', now)).toEqual(['김철수']);
});

test('duplicate warning can be overridden, other warnings cannot', async () => {
  const d = new Date().toISOString().slice(0, 10);
  await receipts.put(makeReceipt({ id: 'a', date: d }));
  await receipts.put(makeReceipt({ id: 'b', date: d }));
  expect((await confirmReceipt('b')).warnings).toEqual(['중복일 수 있어요']);
  expect((await confirmReceipt('b', { allowDuplicate: true })).ok).toBe(true);
  await receipts.put(makeReceipt({ id: 'c', date: d, item: '' }));
  expect((await confirmReceipt('c', { allowDuplicate: true })).ok).toBe(false);
});

test('nextToReview returns the oldest other needs_review receipt', async () => {
  await receipts.put(makeReceipt({ id: 'a', status: 'needs_review', createdAt: '2026-11-01T00:00:00Z' }));
  await receipts.put(makeReceipt({ id: 'b', status: 'needs_review', createdAt: '2026-11-02T00:00:00Z' }));
  await receipts.put(makeReceipt({ id: 'c', status: 'done', createdAt: '2026-10-01T00:00:00Z' }));
  expect(await nextToReview('a')).toBe('b');
  expect(await nextToReview('b')).toBe('a');
  await receipts.put({ ...(await receipts.get('b'))!, status: 'done' });
  expect(await nextToReview('a')).toBeNull();
});
