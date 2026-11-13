import { sortReceipts } from '../domain/sort';
import type { Receipt, Settings } from '../domain/types';
import { paginate, type LayoutReceipt } from '../layout/paginate';
import { fileName } from './fileName';

export type GenerateMode = 'month' | 'pending';

const UNRESOLVED = new Set(['queued', 'recognizing', 'needs_review']);

/** 문서에 넣을 영수증과 그중 아직 확인이 안 끝난 영수증 */
export function selectTargets(all: Receipt[], mode: GenerateMode): { targets: Receipt[]; unresolved: Receipt[] } {
  const targets = all.filter((r) => r.status !== 'excluded' && (mode === 'month' || r.generatedAt === null));
  return { targets, unresolved: targets.filter((r) => UNRESOLVED.has(r.status)) };
}

export interface GenerateDeps {
  fonts: () => Promise<{ regular: Uint8Array }>;
  /** 높이/너비 */
  aspect: (b: Blob) => Promise<number>;
}

export interface GeneratedDocs {
  pdf: { name: string; blob: Blob };
  xlsx: { name: string; blob: Blob };
  /** 열 수 없거나 지워진 사진 수 (문서에서 빠짐) */
  skippedPhotos: number;
}

async function browserDeps(): Promise<GenerateDeps> {
  const [{ loadFonts }, { imageAspect }] = await Promise.all([import('./fonts'), import('../imaging/browser')]);
  return { fonts: loadFonts, aspect: imageAspect };
}

const asBlob = (bytes: Uint8Array, type: string) => new Blob([bytes as Uint8Array<ArrayBuffer>], { type });

export async function generateDocs(
  targets: Receipt[],
  ctx: { ym: string; settings: Settings; partial: boolean },
  deps?: GenerateDeps,
): Promise<GeneratedDocs> {
  const d = deps ?? (await browserDeps());
  const sorted = sortReceipts(targets, ctx.settings.sortOrder);
  const photoBytes = new Map<string, Uint8Array>();
  let skippedPhotos = 0;
  const layout: LayoutReceipt[] = [];
  for (const r of sorted) {
    const photos: LayoutReceipt['photos'] = [];
    for (const p of r.photos) {
      const blob = p.processed ?? p.original;
      if (!blob) {
        skippedPhotos++;
        continue;
      }
      try {
        const aspect = await d.aspect(blob);
        if (!Number.isFinite(aspect) || aspect <= 0) throw new Error('bad aspect');
        photoBytes.set(p.id, new Uint8Array(await blob.arrayBuffer()));
        photos.push({ photoId: p.id, aspect });
      } catch {
        skippedPhotos++;
      }
    }
    layout.push({ id: r.id, date: r.date, photos });
  }

  const [{ buildPdf }, { buildXlsx }, fonts] = await Promise.all([import('./pdf'), import('./xlsx'), d.fonts()]);
  const pdfBytes = await buildPdf({
    pages: paginate(layout),
    receipts: new Map(sorted.map((r) => [r.id, r])),
    photoBytes,
    fonts,
    cardFallback: ctx.settings.cardLast4,
  });
  const xlsxBytes = await buildXlsx(sorted, ctx.ym);
  const nameOpts = {
    ym: ctx.ym,
    cardLast4: ctx.settings.cardLast4,
    user: ctx.settings.defaultUser,
    partial: ctx.partial,
    receipts: sorted,
  };
  return {
    pdf: { name: fileName(nameOpts, 'pdf'), blob: asBlob(pdfBytes, 'application/pdf') },
    xlsx: {
      name: fileName(nameOpts, 'xlsx'),
      blob: asBlob(xlsxBytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    },
    skippedPhotos,
  };
}
