import type { Receipt, ReceiptStatus } from '../domain/types';
import { db } from './db';

export class StorageFullError extends Error {
  constructor() {
    super('저장 공간이 부족해요');
    this.name = 'StorageFullError';
  }
}

function isQuota(e: unknown): boolean {
  const name = (e as { name?: string; inner?: { name?: string } } | null)?.name;
  const inner = (e as { inner?: { name?: string } } | null)?.inner?.name;
  return name === 'QuotaExceededError' || inner === 'QuotaExceededError';
}

async function guard<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (isQuota(e)) throw new StorageFullError();
    throw e;
  }
}

/** 영수증이 속한 달 'YYYY-MM': date 우선, 없으면 createdAt */
export function monthOf(r: Receipt): string {
  return (r.date ?? r.createdAt).slice(0, 7);
}

export const receipts = {
  put(r: Receipt): Promise<string> {
    return guard(db.receipts.put(r));
  },
  get(id: string): Promise<Receipt | undefined> {
    return db.receipts.get(id);
  },
  async remove(id: string): Promise<void> {
    await db.receipts.delete(id);
  },
  all(): Promise<Receipt[]> {
    return db.receipts.toArray();
  },
  listByMonth(ym: string): Promise<Receipt[]> {
    return db.receipts.filter((r) => monthOf(r) === ym).toArray();
  },
  listByStatus(statuses: ReceiptStatus[]): Promise<Receipt[]> {
    return db.receipts.where('status').anyOf(statuses).toArray();
  },
  async markGenerated(ids: string[], at: string): Promise<void> {
    await db.receipts.where('id').anyOf(ids).modify({ generatedAt: at, updatedAt: at });
  },
  async purgeMonth(ym: string, mode: 'photos' | 'all'): Promise<number> {
    const list = await receipts.listByMonth(ym);
    if (mode === 'all') {
      await db.receipts.bulkDelete(list.map((r) => r.id));
      return list.length;
    }
    for (const r of list) {
      // 보정본이 없으면 원본이 유일한 사진이라 지우지 않는다
      await db.receipts.put({ ...r, photos: r.photos.map((p) => (p.processed ? { ...p, original: null } : p)) });
    }
    return list.length;
  },
};
