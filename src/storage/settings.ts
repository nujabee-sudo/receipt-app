import type { Settings } from '../domain/types';
import { db } from './db';

export const DEFAULT_SETTINGS: Settings = {
  geminiKey: '',
  cardLast4: '',
  defaultUser: '',
  vehicle: '',
  sortOrder: 'desc',
};

export const settings = {
  async get(): Promise<Settings> {
    const row = await db.settings.get('main');
    if (!row) return { ...DEFAULT_SETTINGS };
    const { key: _key, ...rest } = row;
    return { ...DEFAULT_SETTINGS, ...rest };
  },
  async save(patch: Partial<Settings>): Promise<Settings> {
    const next = { ...(await settings.get()), ...patch };
    await db.settings.put({ key: 'main', ...next });
    return next;
  },
};
