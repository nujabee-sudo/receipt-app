import JSZip from 'jszip';
import type { Photo, Preset, Receipt, Settings } from '../domain/types';
import { db } from '../storage/db';
import { settings as settingsStore } from '../storage/settings';

const META_KEY = 'lastBackupAt';
const REMIND_MS = 30 * 24 * 60 * 60 * 1000;

type StoredPhoto = Omit<Photo, 'original' | 'processed'> & { hasOriginal: boolean; hasProcessed: boolean };
type StoredReceipt = Omit<Receipt, 'photos'> & { photos: StoredPhoto[] };

interface BackupData {
  version: 1;
  exportedAt: string;
  receipts: StoredReceipt[];
  presets: Preset[];
  settings: Omit<Settings, 'geminiKey'>;
}

const ymd = (d: Date) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

/** 사진 포함 zip 하나로 내보낸다. API 키는 넣지 않는다. */
export async function exportBackup(now: Date): Promise<{ name: string; blob: Blob }> {
  const zip = new JSZip();
  const photos = zip.folder('photos')!;
  const all = await db.receipts.toArray();
  const stored: StoredReceipt[] = all.map((r) => ({
    ...r,
    photos: r.photos.map(({ original, processed, ...p }) => {
      if (original) photos.file(`${p.id}-original.jpg`, original.arrayBuffer());
      if (processed) photos.file(`${p.id}-processed.jpg`, processed.arrayBuffer());
      return { ...p, hasOriginal: !!original, hasProcessed: !!processed };
    }),
  }));
  const { geminiKey: _omit, ...safeSettings } = await settingsStore.get();
  const data: BackupData = {
    version: 1,
    exportedAt: now.toISOString(),
    receipts: stored,
    presets: await db.presets.toArray(),
    settings: safeSettings,
  };
  zip.file('data.json', JSON.stringify(data));
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  return { name: `receipts-backup-${ymd(now)}.zip`, blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' }) };
}

/** 같은 id면 updatedAt이 더 최근인 쪽을 남긴다. API 키는 기존 값을 유지한다. */
export async function importBackup(file: Blob): Promise<{ added: number; updated: number; skipped: number }> {
  let zip: JSZip;
  let data: BackupData;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
    data = JSON.parse(await zip.file('data.json')!.async('string'));
    if (data.version !== 1 || !Array.isArray(data.receipts)) throw new Error();
  } catch {
    throw new Error('백업 파일이 아니에요');
  }

  const readPhoto = async (name: string, present: boolean) => {
    const f = present ? zip.file(`photos/${name}`) : null;
    return f ? new Blob([(await f.async('uint8array')) as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }) : null;
  };

  let added = 0,
    updated = 0,
    skipped = 0;
  for (const sr of data.receipts) {
    const cur = await db.receipts.get(sr.id);
    if (cur && cur.updatedAt >= sr.updatedAt) {
      skipped++;
      continue;
    }
    const photos: Photo[] = [];
    for (const { hasOriginal, hasProcessed, ...p } of sr.photos)
      photos.push({
        ...p,
        original: await readPhoto(`${p.id}-original.jpg`, hasOriginal),
        processed: await readPhoto(`${p.id}-processed.jpg`, hasProcessed),
      });
    await db.receipts.put({ ...sr, photos });
    if (cur) updated++;
    else added++;
  }

  for (const p of data.presets ?? []) {
    const cur = await db.presets.get([p.kind, p.value]);
    if (!cur || cur.lastUsedAt < p.lastUsedAt) await db.presets.put(p);
  }
  if (data.settings) await settingsStore.save({ ...data.settings });
  return { added, updated, skipped };
}

/** 백업 파일을 실제로 저장·공유한 뒤에만 호출한다 (공유 취소는 백업이 아니다) */
export async function markBackedUp(now: Date): Promise<void> {
  await db.meta.put({ key: META_KEY, value: now.toISOString() });
}

export async function lastBackupAt(): Promise<string | null> {
  return (await db.meta.get(META_KEY))?.value ?? null;
}

export async function needsBackupReminder(now: Date): Promise<boolean> {
  if ((await db.receipts.count()) === 0) return false;
  const last = await lastBackupAt();
  return last === null || now.getTime() - Date.parse(last) > REMIND_MS;
}
