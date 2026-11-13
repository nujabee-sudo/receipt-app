import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import { composeContent } from '../domain/content';
import type { Receipt } from '../domain/types';
import { DEFAULT_SPEC, type Page, type PageSpec } from '../layout/paginate';
import { fitText } from './fitText';

const K = 72 / 25.4; // mm → pt
const TITLE = '법인카드사용 지출내역서';
const TITLE_PT = 18;
const COLS = [0.12, 0.22, 0.12, 0.21, 0.12, 0.21];
const LINE = 0.75;
const PAD = 1.5; // mm, 셀 안쪽 여백
const BLACK = rgb(0, 0, 0);
const LABEL_BG = rgb(0.95, 0.95, 0.95);

export interface PdfInput {
  pages: Page[];
  receipts: Map<string, Receipt>;
  /** photoId → JPEG 바이트 */
  photoBytes: Map<string, Uint8Array>;
  fonts: { regular: Uint8Array };
  /** 영수증에서 카드번호를 못 읽었을 때 쓰는 기본 카드 */
  cardFallback: string;
  spec?: PageSpec;
}

// 대체 글리프는 pdf-lib 폭 표에 없어서 간격이 틀어진다 → 치환 기능을 모두 끈다
const NO_SUBSTITUTION = { ccmp: false, locl: false, calt: false, kern: false, liga: false, clig: false, rclt: false, rlig: false, frac: false, numr: false, dnom: false };

const won = (n: number | null) => (n === null ? '' : n.toLocaleString('ko-KR'));

export async function buildPdf(input: PdfInput): Promise<Uint8Array> {
  const s = input.spec ?? DEFAULT_SPEC;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  // pdf-lib의 한글 서브셋은 글자가 빠지는 문제가 있어 글꼴 전체를 넣는다(약 1.2MB).
  // 굵은 글꼴을 따로 넣지 않고 제목은 살짝 겹쳐 그려 굵게 보이게 한다.
  const regular = await doc.embedFont(input.fonts.regular, { subset: false, features: NO_SUBSTITUTION });
  const images = new Map<string, PDFImage>();
  const imageFor = async (photoId: string) => {
    if (!images.has(photoId)) {
      const bytes = input.photoBytes.get(photoId);
      if (!bytes) return null;
      images.set(photoId, await doc.embedJpg(bytes));
    }
    return images.get(photoId)!;
  };

  const tableW = s.pageW - 2 * s.marginX;
  const colX: number[] = [];
  COLS.reduce((x, f) => (colX.push(x), x + f * tableW), s.marginX);
  const colW = COLS.map((f) => f * tableW);

  for (const pg of input.pages) {
    const page = doc.addPage([s.pageW * K, s.pageH * K]);
    const y = (mm: number) => (s.pageH - mm) * K; // 위 기준 mm → pdf y

    // 제목
    const tw = regular.widthOfTextAtSize(TITLE, TITLE_PT);
    for (const dx of [0, 0.35, 0.7])
      page.drawText(TITLE, {
        x: (s.pageW * K - tw) / 2 + dx,
        y: y(s.marginTop + s.titleH / 2) - TITLE_PT * 0.35,
        size: TITLE_PT,
        font: regular,
        color: BLACK,
      });

    const cell = (x: number, top: number, w: number, text: string, align: 'center' | 'right', label: boolean) => {
      if (label) page.drawRectangle({ x: x * K, y: y(top + s.rowH), width: w * K, height: s.rowH * K, color: LABEL_BG });
      page.drawRectangle({
        x: x * K,
        y: y(top + s.rowH),
        width: w * K,
        height: s.rowH * K,
        borderColor: BLACK,
        borderWidth: LINE,
      });
      drawFitted(page, regular, text, x, top, w, s.rowH, align, y);
    };

    pg.receiptIds.forEach((id, i) => {
      const r = input.receipts.get(id)!;
      const top1 = pg.tableTop + i * 2 * s.rowH;
      const top2 = top1 + s.rowH;
      cell(colX[0], top1, colW[0], '일자', 'center', true);
      cell(colX[1], top1, colW[1], r.date ?? '', 'center', false);
      cell(colX[2], top1, colW[2], '카드번호', 'center', true);
      cell(colX[3], top1, colW[3], r.cardLast4 ?? input.cardFallback, 'center', false);
      cell(colX[4], top1, colW[4], '사용금액', 'center', true);
      cell(colX[5], top1, colW[5], won(r.amount), 'right', false);
      cell(colX[0], top2, colW[0], '내용', 'center', true);
      cell(colX[1], top2, colW[1] + colW[2] + colW[3], composeContent(r.site, r.item), 'center', false);
      cell(colX[4], top2, colW[4], '사용자', 'center', true);
      cell(colX[5], top2, colW[5], r.users.join(', '), 'center', false);
    });

    for (const ph of pg.photos) {
      const img = await imageFor(ph.photoId);
      if (!img) continue;
      page.drawImage(img, { x: ph.x * K, y: y(ph.y + ph.h), width: ph.w * K, height: ph.h * K });
    }
  }
  return doc.save();
}

function drawFitted(
  page: PDFPage,
  font: PDFFont,
  text: string,
  x: number,
  top: number,
  w: number,
  h: number,
  align: 'center' | 'right',
  y: (mm: number) => number,
) {
  if (!text) return;
  const maxW = (w - 2 * PAD) * K;
  const { size, lines } = fitText(text, maxW, (t, sz) => font.widthOfTextAtSize(t, sz));
  const lineH = size * 1.15;
  const blockH = lineH * lines.length;
  const cellMidY = y(top + h / 2);
  lines.forEach((line, i) => {
    const lw = font.widthOfTextAtSize(line, size);
    const lx = align === 'right' ? (x + w - PAD) * K - lw : x * K + (w * K - lw) / 2;
    const ly = cellMidY + blockH / 2 - lineH * (i + 1) + (lineH - size) / 2 + size * 0.15;
    page.drawText(line, { x: lx, y: ly, size, font, color: BLACK });
  });
}
