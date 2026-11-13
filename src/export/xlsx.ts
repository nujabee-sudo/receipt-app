import ExcelJS from 'exceljs';
import { composeContent } from '../domain/content';
import type { Receipt } from '../domain/types';

const HEADERS = ['No', '일자', '카드번호', '사용금액', '내용', '사용자', '가맹점', '승인번호'];
const WIDTHS = [6, 12, 10, 12, 50, 18, 24, 12];

const thin = { style: 'thin' as const };
const border = { top: thin, left: thin, bottom: thin, right: thin };

/** 이미 정렬된 영수증으로 월별 사용내역 엑셀을 만든다 */
export async function buildXlsx(receipts: Receipt[], ym: string): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(ym);
  ws.columns = WIDTHS.map((width) => ({ width }));

  const head = ws.addRow(HEADERS);
  head.eachCell((c) => {
    c.font = { bold: true };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF5' } };
    c.border = border;
  });

  receipts.forEach((r, i) => {
    const row = ws.addRow([
      i + 1,
      r.date ?? '',
      r.cardLast4 ?? '',
      r.amount ?? '',
      composeContent(r.site, r.item),
      r.users.join(', '),
      r.merchant ?? '',
      r.approvalNo ?? '',
    ]);
    row.eachCell({ includeEmpty: true }, (c) => (c.border = border));
    row.getCell(4).numFmt = '#,##0';
    row.getCell(1).alignment = { horizontal: 'center' };
    row.getCell(2).alignment = { horizontal: 'center' };
    row.getCell(3).alignment = { horizontal: 'center' };
  });

  const total = receipts.reduce((a, r) => a + (r.amount ?? 0), 0);
  const sum = ws.addRow(['합계', '', '', total]);
  ws.mergeCells(sum.number, 1, sum.number, 3);
  sum.font = { bold: true };
  sum.getCell(1).alignment = { horizontal: 'center' };
  sum.getCell(4).numFmt = '#,##0';
  for (let c = 1; c <= HEADERS.length; c++) sum.getCell(c).border = border;

  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}
