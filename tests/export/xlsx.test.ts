import { expect, test } from 'vitest';
import ExcelJS from 'exceljs';
import { fileName } from '../../src/export/fileName';
import { buildXlsx } from '../../src/export/xlsx';
import { makeReceipt } from '../helpers';

const base = { ym: '2026-09', cardLast4: '1234', user: '김철수' };

test('full month file name', () => {
  expect(fileName({ ...base, partial: false, receipts: [] }, 'pdf')).toBe(
    '2026년 9월 법인카드(#1234) 사용내역서_김철수.pdf',
  );
});

test('partial file name has date range', () => {
  const receipts = [makeReceipt({ date: '2026-09-15' }), makeReceipt({ date: '2026-09-01' })];
  expect(fileName({ ...base, partial: true, receipts }, 'xlsx')).toBe(
    '2026년 9월 법인카드(#1234) 사용내역서_김철수(09.01~09.15).xlsx',
  );
});

test('fileName ignores null dates in range', () => {
  const receipts = [makeReceipt({ date: null }), makeReceipt({ date: '2026-09-03' })];
  expect(fileName({ ...base, partial: true, receipts }, 'pdf')).toBe(
    '2026년 9월 법인카드(#1234) 사용내역서_김철수(09.03~09.03).pdf',
  );
  expect(fileName({ ...base, partial: true, receipts: [makeReceipt({ date: null })] }, 'pdf')).toBe(
    '2026년 9월 법인카드(#1234) 사용내역서_김철수.pdf',
  );
});

test('fileName strips characters not allowed in file names', () => {
  expect(fileName({ ...base, user: '김/철:수', partial: false, receipts: [] }, 'pdf')).toBe(
    '2026년 9월 법인카드(#1234) 사용내역서_김철수.pdf',
  );
});

async function read(bytes: Uint8Array) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  return wb;
}

test('xlsx layout, values, formats, total', async () => {
  const list = [
    makeReceipt({ id: 'a' }),
    makeReceipt({
      id: 'b',
      date: '2026-09-29',
      time: '13:00',
      amount: 13200,
      item: '중식',
      users: ['이영희', '김철수'],
      merchant: '한빛식당',
      approvalNo: '83702273',
    }),
  ];
  const wb = await read(await buildXlsx(list, '2026-09'));
  const ws = wb.getWorksheet('2026-09')!;
  expect(ws).toBeDefined();
  expect((ws.getRow(1).values as unknown[]).slice(1)).toEqual([
    'No',
    '일자',
    '카드번호',
    '사용금액',
    '내용',
    '사용자',
    '가맹점',
    '승인번호',
  ]);
  expect((ws.getRow(2).values as unknown[]).slice(1)).toEqual([
    1,
    '2026-09-29',
    '1234',
    10000,
    '가나테크_서울 본사, 1호기 시운전 : 요소수(쏘렌토)',
    '김철수',
    '행복주유소',
    '12345678',
  ]);
  expect(ws.getRow(3).getCell(6).value).toBe('이영희, 김철수');
  expect(ws.getRow(2).getCell(4).numFmt).toBe('#,##0');
  expect(ws.getRow(1).getCell(1).font?.bold).toBe(true);
  const last = ws.getRow(4);
  expect(last.getCell(1).value).toBe('합계');
  expect(last.getCell(4).value).toBe(23200);
});

test('null date renders blank cell', async () => {
  const wb = await read(await buildXlsx([makeReceipt({ date: null, amount: null, cardLast4: null })], '2026-09'));
  const row = wb.getWorksheet('2026-09')!.getRow(2);
  expect(row.getCell(2).value ?? '').toBe('');
  expect(row.getCell(4).value ?? '').toBe('');
});
