import Dexie, { type Table } from 'dexie';
import type { Preset, Receipt, Settings } from '../domain/types';

export interface SettingsRow extends Settings {
  key: 'main';
}

export interface MetaRow {
  key: string;
  value: string;
}

class ReceiptDB extends Dexie {
  receipts!: Table<Receipt, string>;
  presets!: Table<Preset, [string, string]>;
  settings!: Table<SettingsRow, string>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super('receipt-app');
    this.version(1).stores({
      receipts: 'id, date, status, generatedAt, createdAt',
      presets: '[kind+value], kind',
      settings: 'key',
      meta: 'key',
    });
  }
}

export const db = new ReceiptDB();

/** 브라우저가 저장소를 함부로 지우지 않게 요청. 지원 안 하면 false. */
export async function requestPersistence(): Promise<boolean> {
  const storage = (globalThis.navigator as Navigator | undefined)?.storage;
  if (!storage?.persist) return false;
  try {
    return await storage.persist();
  } catch {
    return false;
  }
}
