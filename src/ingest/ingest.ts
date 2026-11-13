import type { Photo, Receipt } from '../domain/types';
import { validateReceipt, W } from '../domain/validate';
import { DecodeError } from '../imaging/errors';
import { presets } from '../storage/presets';
import { receipts, StorageFullError } from '../storage/receipts';
import { settings } from '../storage/settings';
import { newId, today } from '../ui/format';

export interface IngestContext {
  site: string;
  defaultUser: string;
  /** 원본을 긴 변 2400px JPEG로 줄인다 (브라우저: resizeJpeg) */
  resize: (b: Blob) => Promise<Blob>;
}

export interface IngestResult {
  added: string[];
  failed: { name: string; message: string }[];
}

function emptyReceipt(id: string, photo: Photo, ctx: IngestContext, now: string): Receipt {
  return {
    id,
    date: null,
    time: null,
    amount: null,
    cardLast4: null,
    merchant: null,
    approvalNo: null,
    site: ctx.site.trim(),
    item: '',
    users: ctx.defaultUser.trim() ? [ctx.defaultUser.trim()] : [],
    photos: [photo],
    status: 'queued',
    warnings: [],
    isCancellation: false,
    generatedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** 사진들을 저장하고 인식 대기열(queued)에 넣는다. 열 수 없는 파일은 건너뛰고 알려준다. */
export async function ingestFiles(files: File[], ctx: IngestContext): Promise<IngestResult> {
  const out: IngestResult = { added: [], failed: [] };
  for (const f of files) {
    try {
      const original = await ctx.resize(f);
      const now = new Date().toISOString();
      const id = newId();
      await receipts.put(emptyReceipt(id, { id: newId(), original, processed: null, corners: null }, ctx, now));
      out.added.push(id);
    } catch (e) {
      if (e instanceof StorageFullError) {
        out.failed.push({ name: f.name, message: e.message });
        break;
      }
      out.failed.push({ name: f.name, message: e instanceof DecodeError ? e.message : '사진을 저장하지 못했어요' });
    }
  }
  if (out.added.length) await presets.touch('site', ctx.site, new Date().toISOString());
  return out;
}

/** 확인: 검증을 통과하면 done으로 바꾸고 프리셋을 기록한다. 중복 경고만은 allowDuplicate로 넘길 수 있다. */
export async function confirmReceipt(
  id: string,
  opts: { allowDuplicate?: boolean } = {},
): Promise<{ ok: boolean; warnings: string[] }> {
  const r = await receipts.get(id);
  if (!r) return { ok: false, warnings: ['영수증을 찾을 수 없어요'] };
  const s = await settings.get();
  let warnings = validateReceipt(r, { today: today(), cardLast4: s.cardLast4, others: await receipts.all() });
  if (opts.allowDuplicate) warnings = warnings.filter((w) => w !== W.duplicate);
  const now = new Date().toISOString();
  if (warnings.length) {
    await receipts.put({ ...r, warnings, updatedAt: now });
    return { ok: false, warnings };
  }
  await receipts.put({ ...r, status: 'done', warnings: [], updatedAt: now });
  await presets.touch('site', r.site, now);
  await presets.touch('item', r.item, now);
  for (const u of r.users) await presets.touch('user', u, now);
  return { ok: true, warnings: [] };
}

/** 확인이 필요한 다음 건 (가장 먼저 등록된 것) */
export async function nextToReview(currentId: string): Promise<string | null> {
  const list = (await receipts.listByStatus(['needs_review']))
    .filter((r) => r.id !== currentId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return list[0]?.id ?? null;
}
