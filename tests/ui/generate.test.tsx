// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { db } from '../../src/storage/db';
import { receipts } from '../../src/storage/receipts';
import { settings } from '../../src/storage/settings';
import { makeReceipt } from '../helpers';

const share = vi.fn();
const generate = vi.fn();
vi.mock('../../src/export/share', () => ({ shareOrDownload: (...a: unknown[]) => share(...a) }));
vi.mock('../../src/export/generate', async (orig) => ({
  ...(await orig<typeof import('../../src/export/generate')>()),
  generateDocs: (...a: unknown[]) => generate(...a),
}));
const { GeneratePage } = await import('../../src/ui/GeneratePage');

beforeEach(async () => {
  await db.delete();
  await db.open();
  await settings.save({ cardLast4: '1234', defaultUser: '김철수' });
  share.mockReset();
  generate.mockReset().mockResolvedValue({
    pdf: { name: 'a.pdf', blob: new Blob(['%PDF-'], { type: 'application/pdf' }) },
    xlsx: { name: 'a.xlsx', blob: new Blob(['x']) },
    skippedPhotos: 0,
  });
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

const renderGen = () =>
  render(
    <MemoryRouter initialEntries={['/generate?ym=2026-09']}>
      <Routes>
        <Route path="/generate" element={<GeneratePage />} />
        <Route path="*" element={null} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );

test('no targets shows a message and disables the button', async () => {
  renderGen();
  expect(await screen.findByText('만들 영수증이 없어요')).toBeTruthy();
  expect((screen.getByRole('button', { name: '문서 만들기' }) as HTMLButtonElement).disabled).toBe(true);
});

test('unresolved receipts ask before generating', async () => {
  await receipts.put(makeReceipt({ id: 'a', date: '2026-09-02', status: 'done' }));
  await receipts.put(makeReceipt({ id: 'b', date: '2026-09-03', status: 'needs_review', merchant: '확인할가게' }));
  renderGen();
  fireEvent.click(await screen.findByRole('button', { name: '문서 만들기' }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog.textContent).toContain('확인할가게');
  expect(generate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '돌아가서 확인' }));
  await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/review/b'));
});

test('proceeding anyway generates with every target', async () => {
  await receipts.put(makeReceipt({ id: 'a', date: '2026-09-02', status: 'done' }));
  await receipts.put(makeReceipt({ id: 'b', date: '2026-09-03', status: 'needs_review' }));
  renderGen();
  fireEvent.click(await screen.findByRole('button', { name: '문서 만들기' }));
  fireEvent.click(await screen.findByRole('button', { name: '그래도 진행' }));
  await waitFor(() => expect(generate).toHaveBeenCalledOnce());
  expect((generate.mock.calls[0][0] as { id: string }[]).map((r) => r.id).sort()).toEqual(['a', 'b']);
  expect(await screen.findByTitle('PDF 미리보기')).toBeTruthy();
  expect(screen.getByRole('link', { name: '새 탭에서 보기' })).toBeTruthy();
});

test('cancelled share does not mark receipts as generated', async () => {
  await receipts.put(makeReceipt({ id: 'a', date: '2026-09-02', status: 'done' }));
  share.mockResolvedValue('cancelled');
  renderGen();
  fireEvent.click(await screen.findByRole('button', { name: '문서 만들기' }));
  fireEvent.click(await screen.findByRole('button', { name: 'PDF 저장/공유' }));
  await waitFor(() => expect(share).toHaveBeenCalledOnce());
  expect((await receipts.get('a'))!.generatedAt).toBeNull();
});

test('saving only the Excel file does not mark receipts as generated', async () => {
  await receipts.put(makeReceipt({ id: 'a', date: '2026-09-02', status: 'done' }));
  share.mockResolvedValue('downloaded');
  renderGen();
  fireEvent.click(await screen.findByRole('button', { name: '문서 만들기' }));
  fireEvent.click(await screen.findByRole('button', { name: '엑셀 저장/공유' }));
  await waitFor(() => expect(share).toHaveBeenCalledOnce());
  expect(await screen.findByText('저장했어요')).toBeTruthy();
  expect((await receipts.get('a'))!.generatedAt).toBeNull();
});

test('a successful PDF download marks the receipts as generated', async () => {
  await receipts.put(makeReceipt({ id: 'a', date: '2026-09-02', status: 'done' }));
  share.mockResolvedValue('downloaded');
  renderGen();
  fireEvent.click(await screen.findByRole('button', { name: '문서 만들기' }));
  fireEvent.click(await screen.findByRole('button', { name: 'PDF 저장/공유' }));
  await waitFor(async () => expect((await receipts.get('a'))!.generatedAt).not.toBeNull());
});

test('pending mode passes partial and only ungenerated receipts', async () => {
  await receipts.put(makeReceipt({ id: 'a', date: '2026-09-02', status: 'done', generatedAt: '2026-09-05T00:00:00Z' }));
  await receipts.put(makeReceipt({ id: 'b', date: '2026-09-07', status: 'done' }));
  renderGen();
  fireEvent.click(await screen.findByLabelText('아직 문서로 안 만든 것만'));
  fireEvent.click(await screen.findByRole('button', { name: '문서 만들기' }));
  await waitFor(() => expect(generate).toHaveBeenCalledOnce());
  expect((generate.mock.calls[0][0] as { id: string }[]).map((r) => r.id)).toEqual(['b']);
  expect((generate.mock.calls[0][1] as { partial: boolean }).partial).toBe(true);
});
