// 사용: npx tsx scripts/render-sample-pdf.ts [기준자료폴더]
// 기준 자료(tests/fixtures/reference/answers.json + jpg)가 있으면 그걸로, 없으면 가짜 사진으로 out/sample.pdf 생성
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPdf } from '../src/export/pdf';
import { paginate } from '../src/layout/paginate';
import { sortReceipts } from '../src/domain/sort';
import type { Receipt } from '../src/domain/types';

/** JPEG SOF 마커에서 너비/높이 읽기 */
export function jpegSize(b: Uint8Array): { width: number; height: number } {
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1];
    const len = (b[i + 2] << 8) | b[i + 3];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
      return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
    i += 2 + len;
  }
  throw new Error('JPEG 크기를 읽을 수 없어요');
}

interface Answer {
  file: string;
  date: string;
  amount: number;
  merchant?: string;
  site?: string;
  item?: string;
  users?: string[];
}

const dir = process.argv[2] ?? 'tests/fixtures/reference';
const fontDir = 'node_modules/pretendard/dist/public/static/alternative/';
const fonts = {
  regular: new Uint8Array(readFileSync(fontDir + 'Pretendard-Regular.ttf')),
  bold: new Uint8Array(readFileSync(fontDir + 'Pretendard-Bold.ttf')),
};

let answers: Answer[];
const photoBytes = new Map<string, Uint8Array>();
if (existsSync(join(dir, 'answers.json'))) {
  answers = JSON.parse(readFileSync(join(dir, 'answers.json'), 'utf8'));
  for (const a of answers) photoBytes.set(a.file, new Uint8Array(readFileSync(join(dir, a.file))));
} else {
  const tiny = new Uint8Array(readFileSync('tests/fixtures/tiny.jpg'));
  answers = [
    { file: 'a', date: '2026-09-29', amount: 10000, item: '요소수(쏘렌토)', merchant: '행복주유소' },
    { file: 'b', date: '2026-09-29', amount: 111000, item: '주유(쏘렌토)', merchant: '천일 주유소' },
    { file: 'c', date: '2026-09-29', amount: 13200, item: '중식', users: ['이영희', '김철수'] },
    { file: 'd', date: '2026-09-21', amount: 13200, item: '중식', users: ['박민수', '김철수'] },
    { file: 'e', date: '2026-09-17', amount: 22000, item: '중식', site: '다라화학 2공장 A/S' },
  ];
  for (const a of answers) photoBytes.set(a.file, tiny);
}

const receipts: Receipt[] = answers.map((a, i) => ({
  id: a.file,
  date: a.date,
  time: `12:${String(59 - i).padStart(2, '0')}`,
  amount: a.amount,
  cardLast4: '1234',
  merchant: a.merchant ?? null,
  approvalNo: null,
  site: a.site ?? '가나테크_서울 본사, 1호기 시운전',
  item: a.item ?? '',
  users: a.users ?? ['김철수'],
  photos: [{ id: a.file, original: null, processed: null, corners: null }],
  status: 'done',
  warnings: [],
  isCancellation: false,
  generatedAt: null,
  createdAt: '2026-09-30T00:00:00.000Z',
  updatedAt: '2026-09-30T00:00:00.000Z',
}));

const sorted = sortReceipts(receipts, 'desc');
const fakeAspect = [2.6, 3.2, 2.0, 1.8, 2.2];
const pages = paginate(
  sorted.map((r, i) => {
    const b = photoBytes.get(r.id)!;
    const sz = existsSync(join(dir, 'answers.json')) ? jpegSize(b) : null;
    return { id: r.id, date: r.date, photos: [{ photoId: r.id, aspect: sz ? sz.height / sz.width : fakeAspect[i % 5] }] };
  }),
);
const bytes = await buildPdf({
  pages,
  receipts: new Map(sorted.map((r) => [r.id, r])),
  photoBytes,
  fonts,
  cardFallback: '1234',
});
mkdirSync('out', { recursive: true });
writeFileSync('out/sample.pdf', bytes);
console.log(`out/sample.pdf: ${pages.length}쪽, ${(bytes.length / 1024).toFixed(0)}KB`);
