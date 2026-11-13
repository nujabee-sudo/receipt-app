import type { PresetKind } from '../domain/types';
import { db } from './db';

const RECENT_MS = 30 * 24 * 60 * 60 * 1000;

export const presets = {
  async touch(kind: PresetKind, value: string, now: string): Promise<void> {
    const v = value.trim();
    if (!v) return;
    await db.transaction('rw', db.presets, async () => {
      const cur = await db.presets.get([kind, v]);
      await db.presets.put({ kind, value: v, useCount: (cur?.useCount ?? 0) + 1, lastUsedAt: now });
    });
  },
  /** 최근 30일 안에 쓴 값 먼저, 그 안에서 useCount 내림차순 */
  async list(kind: PresetKind, now: string): Promise<string[]> {
    const t = Date.parse(now);
    const rows = await db.presets.where('kind').equals(kind).toArray();
    const recent = (lastUsedAt: string) => (t - Date.parse(lastUsedAt) <= RECENT_MS ? 1 : 0);
    return rows
      .sort((a, b) => recent(b.lastUsedAt) - recent(a.lastUsedAt) || b.useCount - a.useCount)
      .map((p) => p.value);
  },
  async remove(kind: PresetKind, value: string): Promise<void> {
    await db.presets.delete([kind, value]);
  },
};
