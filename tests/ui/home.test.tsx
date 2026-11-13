// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { db } from '../../src/storage/db';
import { receipts } from '../../src/storage/receipts';
import { settings } from '../../src/storage/settings';
import { HomePage } from '../../src/ui/HomePage';
import { AppContext } from '../../src/ui/appContext';
import type { Queue, RunResult } from '../../src/recognition/queue';
import { SettingsPage } from '../../src/ui/SettingsPage';
import { makeReceipt } from '../helpers';

beforeEach(async () => {
  await db.delete();
  await db.open();
});
afterEach(cleanup);

const renderHome = () =>
  render(
    <MemoryRouter>
      <HomePage initialMonth="2026-09" />
    </MemoryRouter>,
  );

async function seedSeptember() {
  await receipts.put(makeReceipt({ id: 'a', date: '2026-09-29', time: '18:52', amount: 10000, status: 'queued' }));
  await receipts.put(makeReceipt({ id: 'b', date: '2026-09-29', time: '13:00', amount: 13200, status: 'needs_review' }));
  await receipts.put(
    makeReceipt({ id: 'c', date: '2026-09-21', amount: 1400, status: 'done', generatedAt: '2026-10-01T00:00:00Z' }),
  );
  await receipts.put(makeReceipt({ id: 'x', date: '2026-09-17', amount: -150000, status: 'excluded' }));
}

test('groups by date, shows total and count, status icons', async () => {
  await settings.save({ geminiKey: 'K' });
  await seedSeptember();
  renderHome();
  expect(await screen.findByText('24,600원')).toBeTruthy();
  expect(screen.getByText('3건')).toBeTruthy();
  expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
    '9월 29일 (화)',
    '9월 21일 (월)',
  ]);
  expect(screen.getAllByLabelText('인식 중')).toHaveLength(1);
  expect(screen.getAllByLabelText('확인 필요')).toHaveLength(1);
  expect(screen.getAllByLabelText('문서 생성 완료')).toHaveLength(1);
});

test('excluded items are hidden until expanded', async () => {
  await settings.save({ geminiKey: 'K' });
  await seedSeptember();
  renderHome();
  const toggle = await screen.findByRole('button', { name: '제외됨 (1)' });
  expect(screen.queryByText('-150,000원')).toBeNull();
  fireEvent.click(toggle);
  expect(await screen.findByText('-150,000원')).toBeTruthy();
});

test('missing key shows banner', async () => {
  renderHome();
  expect(await screen.findByText('설정에서 Gemini API 키를 입력해 주세요')).toBeTruthy();
});

test('backup reminder banner', async () => {
  await settings.save({ geminiKey: 'K' });
  await seedSeptember();
  renderHome();
  expect(await screen.findByText('백업한 지 30일이 지났어요')).toBeTruthy();
});

test('month navigation changes the list', async () => {
  await settings.save({ geminiKey: 'K' });
  await seedSeptember();
  renderHome();
  await screen.findByText('24,600원');
  fireEvent.click(screen.getByRole('button', { name: '다음 달' }));
  expect(await screen.findByText('2026년 10월')).toBeTruthy();
  expect(await screen.findByText('0건')).toBeTruthy();
});

test('settings: card must be 4 digits; values persist', async () => {
  const view = render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  );
  const card = (await screen.findByLabelText('기본 카드번호 뒷자리')) as HTMLInputElement;
  const save = screen.getByRole('button', { name: '저장' }) as HTMLButtonElement;
  fireEvent.change(card, { target: { value: '06a3' } });
  expect(save.disabled).toBe(true);
  fireEvent.change(card, { target: { value: '1234' } });
  fireEvent.change(screen.getByLabelText('기본 사용자 이름'), { target: { value: '김철수' } });
  expect(save.disabled).toBe(false);
  fireEvent.click(save);
  await waitFor(async () => expect((await settings.get()).cardLast4).toBe('1234'));
  view.unmount();
  render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  );
  await waitFor(() => expect((screen.getByLabelText('기본 사용자 이름') as HTMLInputElement).value).toBe('김철수'));
});

function fakeQueue(status: RunResult) {
  return { status: () => status, onChange: () => () => {}, kick: () => {} } as unknown as Queue;
}
const renderHomeWith = (status: RunResult) =>
  render(
    <AppContext.Provider value={{ queue: fakeQueue(status) }}>
      <MemoryRouter>
        <HomePage initialMonth="2026-09" />
      </MemoryRouter>
    </AppContext.Provider>,
  );

test('a rejected API key is explained with a link to settings', async () => {
  await settings.save({ geminiKey: 'typo' });
  renderHomeWith('auth');
  expect(await screen.findByText(/API 키가 올바르지 않아요/)).toBeTruthy();
});

test('running out of free quota is explained', async () => {
  await settings.save({ geminiKey: 'K' });
  renderHomeWith('quota');
  expect(await screen.findByText(/무료 인식 한도/)).toBeTruthy();
});
