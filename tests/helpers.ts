import type { Receipt } from '../src/domain/types';

export function makeReceipt(over: Partial<Receipt> = {}): Receipt {
  return {
    id: 'r1',
    date: '2026-09-29',
    time: '18:52',
    amount: 10000,
    cardLast4: '1234',
    merchant: '행복주유소',
    approvalNo: '12345678',
    site: '가나테크_서울 본사, 1호기 시운전',
    item: '요소수(쏘렌토)',
    users: ['김철수'],
    photos: [],
    status: 'needs_review',
    warnings: [],
    isCancellation: false,
    generatedAt: null,
    createdAt: '2026-09-29T10:00:00.000Z',
    updatedAt: '2026-09-29T10:00:00.000Z',
    ...over,
  };
}
