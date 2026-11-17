// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useLayoutEffect } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { db } from '../../src/storage/db';
import { receipts } from '../../src/storage/receipts';
import { presets } from '../../src/storage/presets';
import { settings } from '../../src/storage/settings';
import { ReviewPage } from '../../src/ui/ReviewPage';
import { makeReceipt } from '../helpers';

const processPhoto = vi.fn(async (_o: Blob, _c: unknown, rotation = 0) => new Blob([`rot${rotation}`]));
vi.mock('../../src/imaging/browser', () => ({ processPhoto: (...a: [Blob, unknown, number]) => processPhoto(...a) }));

const TODAY = new Date().toISOString().slice(0, 10);

beforeEach(async () => {
  await db.delete();
  await db.open();
  await settings.save({ cardLast4: '1234', defaultUser: '김철수' });
});
afterEach(cleanup);

const seen: string[] = [];
function Where() {
  const path = useLocation().pathname;
  useLayoutEffect(() => {
    const amount = document.querySelector<HTMLInputElement>('input[aria-label="금액"]');
    seen.push(`${path}=${amount?.value ?? ''}`);
  });
  return <div data-testid="where">{path}</div>;
}

const renderReview = (id: string) =>
  render(
    <MemoryRouter initialEntries={[`/review/${id}`]}>
      <Routes>
        <Route path="/review/:id" element={<ReviewPage />} />
        <Route path="*" element={null} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );

test('site autocomplete suggests presets and preview shows content', async () => {
  await presets.touch('site', '가나테크_서울 본사, 1호기 시운전', new Date().toISOString());
  await receipts.put(makeReceipt({ id: 'a', date: TODAY, site: '', item: '중식' }));
  renderReview('a');
  const site = await screen.findByLabelText('현장');
  fireEvent.focus(site);
  fireEvent.change(site, { target: { value: '가나' } });
  fireEvent.click(await screen.findByRole('option', { name: '가나테크_서울 본사, 1호기 시운전' }));
  expect(await screen.findByText('가나테크_서울 본사, 1호기 시운전 : 중식')).toBeTruthy();
});

test('user chips add and remove', async () => {
  await receipts.put(makeReceipt({ id: 'a', date: TODAY }));
  renderReview('a');
  const input = await screen.findByLabelText('사용자 추가');
  fireEvent.change(input, { target: { value: '이영희' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(await screen.findByRole('button', { name: '이영희 삭제' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '김철수 삭제' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '김철수 삭제' })).toBeNull());
});

test('confirm with warnings shows them and stays', async () => {
  await receipts.put(makeReceipt({ id: 'a', date: TODAY, item: '' }));
  renderReview('a');
  fireEvent.click(await screen.findByRole('button', { name: '확인' }));
  expect(await screen.findByText('항목을 입력해 주세요')).toBeTruthy();
  expect(screen.getByTestId('where').textContent).toBe('/review/a');
});

test('confirm without warnings goes to the next receipt to review', async () => {
  await receipts.put(makeReceipt({ id: 'a', date: TODAY, status: 'needs_review', createdAt: '2026-11-01T00:00:00Z' }));
  await receipts.put(
    makeReceipt({ id: 'b', date: TODAY, amount: 5000, status: 'needs_review', createdAt: '2026-11-02T00:00:00Z' }),
  );
  renderReview('a');
  fireEvent.click(await screen.findByRole('button', { name: '확인' }));
  await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/review/b'));
  expect((await receipts.get('a'))!.status).toBe('done');
});

test('duplicate can be confirmed anyway', async () => {
  await receipts.put(makeReceipt({ id: 'a', date: TODAY, status: 'done' }));
  await receipts.put(makeReceipt({ id: 'b', date: TODAY }));
  renderReview('b');
  fireEvent.click(await screen.findByRole('button', { name: '확인' }));
  fireEvent.click(await screen.findByRole('button', { name: '그래도 확인' }));
  await waitFor(async () => expect((await receipts.get('b'))!.status).toBe('done'));
});

test('edits are saved', async () => {
  await receipts.put(makeReceipt({ id: 'a', date: TODAY }));
  renderReview('a');
  fireEvent.change(await screen.findByLabelText('금액'), { target: { value: '12,500' } });
  fireEvent.click(screen.getByRole('button', { name: '확인' }));
  await waitFor(async () => expect((await receipts.get('a'))!.amount).toBe(12500));
});

test('moving to the next receipt never shows the previous receipt values', async () => {
  await receipts.put(makeReceipt({ id: 'a', date: TODAY, amount: 11111, createdAt: '2026-11-01T00:00:00Z' }));
  await receipts.put(makeReceipt({ id: 'b', date: TODAY, amount: 22222, status: 'needs_review', createdAt: '2026-11-02T00:00:00Z' }));
  renderReview('a');
  await screen.findByDisplayValue('11,111');
  fireEvent.click(screen.getByRole('button', { name: '확인' }));
  await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/review/b'));
  expect(await screen.findByDisplayValue('22,222')).toBeTruthy();
  expect(seen.filter((x) => x === '/review/b=11,111')).toEqual([]);
});

test('recognition results that arrive while the screen is open are shown and survive going back', async () => {
  await receipts.put(
    makeReceipt({ id: 'a', status: 'recognizing', date: null, time: null, amount: null, merchant: null, cardLast4: null, item: '' }),
  );
  renderReview('a');
  await screen.findByLabelText('금액');
  const r = (await receipts.get('a'))!;
  await receipts.put({ ...r, status: 'needs_review', date: TODAY, amount: 5000, merchant: '새가게', item: '중식' });
  expect(await screen.findByDisplayValue('5,000')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '뒤로' }));
  await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/'));
  const after = (await receipts.get('a'))!;
  expect(after.amount).toBe(5000);
  expect(after.merchant).toBe('새가게');
  expect(after.item).toBe('중식');
});

test('a field the user edited is kept while unedited fields follow recognition', async () => {
  await receipts.put(makeReceipt({ id: 'a', status: 'recognizing', amount: null, merchant: null }));
  renderReview('a');
  fireEvent.change(await screen.findByLabelText('가맹점'), { target: { value: '내가쓴가게' } });
  const r = (await receipts.get('a'))!;
  await receipts.put({ ...r, amount: 4200, merchant: '인식가게' });
  expect(await screen.findByDisplayValue('4,200')).toBeTruthy();
  expect(screen.getByDisplayValue('내가쓴가게')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '뒤로' }));
  await waitFor(async () => expect((await receipts.get('a'))!.merchant).toBe('내가쓴가게'));
  expect((await receipts.get('a'))!.amount).toBe(4200);
});

test('recognizing again clears the values read from the receipt and requeues it', async () => {
  await receipts.put(makeReceipt({ id: 'a', date: TODAY, amount: 100000, approvalNo: '123', status: 'needs_review' }));
  renderReview('a');
  fireEvent.click(await screen.findByRole('button', { name: '다시 인식' }));
  await waitFor(async () => expect((await receipts.get('a'))!.status).toBe('queued'));
  const r = (await receipts.get('a'))!;
  expect([r.date, r.time, r.amount, r.cardLast4, r.merchant, r.approvalNo]).toEqual([null, null, null, null, null, null]);
  expect(r.site).toBe('가나테크_서울 본사, 1호기 시운전');
  expect(r.users).toEqual(['김철수']);
});

test('the rotate button turns the cleaned-up photo a quarter turn each time', async () => {
  const original = new Blob(['o']);
  const corners: [[number, number], [number, number], [number, number], [number, number]] = [[1, 1], [9, 1], [9, 9], [1, 9]];
  await receipts.put(makeReceipt({ id: 'a', date: TODAY, photos: [{ id: 'p', original, processed: new Blob(['x']), corners }] }));
  processPhoto.mockClear();
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
  renderReview('a');
  fireEvent.click(await screen.findByRole('button', { name: '돌리기' }));
  await waitFor(async () => expect((await receipts.get('a'))!.photos[0].rotation).toBe(90));
  expect(processPhoto.mock.lastCall?.slice(1)).toEqual([corners, 90]);
  expect(processPhoto.mock.lastCall![0]).toBeTruthy(); // 원본으로 다시 만든다
  expect((await receipts.get('a'))!.photos[0].upright).toBe(true); // 다시 인식할 때 바로 세운 사진을 읽는다
  fireEvent.click(screen.getByRole('button', { name: '돌리기' }));
  await waitFor(async () => expect((await receipts.get('a'))!.photos[0].rotation).toBe(180));
  expect(processPhoto.mock.lastCall?.slice(1)).toEqual([corners, 180]);
});
