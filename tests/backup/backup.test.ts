import 'fake-indexeddb/auto';
import { beforeEach, expect, test } from 'vitest';
import JSZip from 'jszip';
import { db } from '../../src/storage/db';
import { receipts } from '../../src/storage/receipts';
import { presets } from '../../src/storage/presets';
import { settings } from '../../src/storage/settings';
import { exportBackup, importBackup, lastBackupAt, markBackedUp, needsBackupReminder } from '../../src/backup/backup';
import { makeReceipt } from '../helpers';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const photo = { id: 'p1', original: new Blob(['ORIGINAL!'], { type: 'image/jpeg' }), processed: new Blob(['PR'], { type: 'image/jpeg' }), corners: null };

async function seed() {
  await receipts.put(makeReceipt({ id: 'a', photos: [photo], updatedAt: '2026-11-01T00:00:00.000Z' }));
  await presets.touch('site', '현장A', '2026-11-01T00:00:00.000Z');
  await settings.save({ geminiKey: 'SECRET', cardLast4: '1234' });
}

test('zip name and contents, no API key', async () => {
  await seed();
  const { name, blob } = await exportBackup(new Date('2026-11-13T09:00:00+09:00'));
  expect(name).toBe('receipts-backup-20261113.zip');
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  expect(Object.keys(zip.files).sort()).toEqual(['data.json', 'photos/', 'photos/p1-original.jpg', 'photos/p1-processed.jpg'].sort());
  const data = JSON.parse(await zip.file('data.json')!.async('string'));
  expect(data.settings.geminiKey).toBeUndefined();
  expect(data.settings.cardLast4).toBe('1234');
  expect(await zip.file('photos/p1-original.jpg')!.async('string')).toBe('ORIGINAL!');
});

test('round trip restores receipts, photos, presets', async () => {
  await seed();
  const { blob } = await exportBackup(new Date());
  await db.delete();
  await db.open();
  const res = await importBackup(blob);
  expect(res).toEqual({ added: 1, updated: 0, skipped: 0 });
  const a = (await receipts.get('a'))!;
  expect(a.photos[0].original!.size).toBe(9);
  expect(a.photos[0].processed!.size).toBe(2);
  expect(await presets.list('site', '2026-11-02T00:00:00.000Z')).toEqual(['현장A']);
  expect((await settings.get()).cardLast4).toBe('1234');
  expect((await settings.get()).geminiKey).toBe('');
});

test('import keeps the newer side on conflict', async () => {
  await seed();
  const { blob } = await exportBackup(new Date());
  await receipts.put(makeReceipt({ id: 'a', merchant: 'DB가 최신', updatedAt: '2026-12-01T00:00:00.000Z' }));
  expect(await importBackup(blob)).toEqual({ added: 0, updated: 0, skipped: 1 });
  expect((await receipts.get('a'))!.merchant).toBe('DB가 최신');

  await receipts.put(makeReceipt({ id: 'a', merchant: 'DB가 예전', updatedAt: '2026-10-01T00:00:00.000Z' }));
  expect(await importBackup(blob)).toEqual({ added: 0, updated: 1, skipped: 0 });
  expect((await receipts.get('a'))!.merchant).toBe('행복주유소');
});

test('import keeps existing API key', async () => {
  await seed();
  const { blob } = await exportBackup(new Date());
  await settings.save({ geminiKey: 'MINE' });
  await importBackup(blob);
  expect((await settings.get()).geminiKey).toBe('MINE');
});

test('export records lastBackupAt; reminder after 30 days', async () => {
  await seed();
  expect(await lastBackupAt()).toBeNull();
  expect(await needsBackupReminder(new Date('2026-11-13T00:00:00Z'))).toBe(true);
  await exportBackup(new Date('2026-10-13T00:00:00Z'));
  expect(await lastBackupAt()).toBeNull(); // 공유를 취소했을 수도 있으니 만들기만으로는 기록하지 않는다
  await markBackedUp(new Date('2026-10-13T00:00:00Z'));
  expect(await lastBackupAt()).toBe('2026-10-13T00:00:00.000Z');
  expect(await needsBackupReminder(new Date('2026-11-13T00:00:00Z'))).toBe(true); // 31일
  expect(await needsBackupReminder(new Date('2026-11-11T00:00:00Z'))).toBe(false); // 29일
});

test('no reminder when there are no receipts', async () => {
  expect(await needsBackupReminder(new Date())).toBe(false);
});

test('invalid file throws a friendly error', async () => {
  await expect(importBackup(new Blob(['nope']))).rejects.toThrow('백업 파일이 아니에요');
});
