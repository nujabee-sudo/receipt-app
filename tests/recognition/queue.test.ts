import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { db } from '../../src/storage/db';
import { receipts } from '../../src/storage/receipts';
import { settings } from '../../src/storage/settings';
import { createQueue, FAILED_WARNING, recognitionSource, type QueueDeps } from '../../src/recognition/queue';
import { RecognitionError, type RecognitionResult } from '../../src/recognition/schema';
import type { Recognizer } from '../../src/recognition/recognizer';
import type { Photo } from '../../src/domain/types';
import { makeReceipt } from '../helpers';

beforeEach(async () => {
  await db.delete();
  await db.open();
  await settings.save({ geminiKey: 'K', cardLast4: '1234', defaultUser: '김철수', vehicle: '쏘렌토' });
});

const photo = (id: string): Photo => ({ id, original: new Blob([id]), processed: null, corners: null });

async function seed(n: number) {
  for (let i = 0; i < n; i++) {
    await receipts.put(
      makeReceipt({
        id: `r${i}`,
        status: 'queued',
        date: null,
        time: null,
        amount: null,
        cardLast4: null,
        merchant: null,
        approvalNo: null,
        site: '',
        item: '',
        photos: [photo(`p${i}`)],
        createdAt: `2026-11-13T00:00:0${i}.000Z`,
      }),
    );
  }
}

const result = (index: number, over: Partial<RecognitionResult> = {}): RecognitionResult => ({
  index,
  date: '2026-11-10',
  time: '12:10',
  amount: 1000 * (index + 1),
  cardLast4: '1234',
  merchant: `가게${index}`,
  approvalNo: null,
  category: 'meal',
  isCancellation: false,
  rotation: 0,
  corners: null,
  ...over,
});

function harness(
  respond: (images: Blob[], call: number) => RecognitionResult[] | Error,
  during?: (call: number) => Promise<void>,
) {
  const calls: Blob[][] = [];
  const sleeps: number[] = [];
  let t = 0;
  const recognizer: Recognizer = {
    async recognize(images) {
      calls.push(images);
      await during?.(calls.length);
      const r = respond(images, calls.length);
      if (r instanceof Error) throw r;
      return r;
    },
  };
  const deps: QueueDeps = {
    recognizer: async () => recognizer,
    prepare: async (p) => p.original!,
    process: async (p) => ({ ...p, processed: new Blob(['proc']) }),
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    isOnline: () => true,
    today: () => '2026-11-13',
  };
  return { deps, calls, sleeps };
}

const allOk = (images: Blob[]) => images.map((_, i) => result(i));

test('processes up to 5 per request', async () => {
  await seed(7);
  const h = harness(allOk);
  const q = createQueue(h.deps);
  expect(await q.runOnce()).toBe('processed');
  expect(await q.runOnce()).toBe('processed');
  expect(h.calls.map((c) => c.length)).toEqual([5, 2]);
  expect(await q.runOnce()).toBe('idle');
});

test('waits 7s between requests', async () => {
  await seed(7);
  const h = harness(allOk);
  const q = createQueue(h.deps);
  await q.runOnce();
  await q.runOnce();
  expect(h.sleeps.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(7000);
});

test('fills fields, suggests item, ends in needs_review', async () => {
  await seed(1);
  const h = harness(() => [result(0, { time: '12:10', category: 'meal' })]);
  await createQueue(h.deps).runOnce();
  const r = (await receipts.get('r0'))!;
  expect(r.status).toBe('needs_review');
  expect(r.amount).toBe(1000);
  expect(r.merchant).toBe('가게0');
  expect(r.item).toBe('중식');
  expect(r.photos[0].processed).not.toBeNull();
  expect(r.warnings).toContain('현장을 입력해 주세요');
});

test('unmatched images are requeued singly', async () => {
  await seed(5);
  const h = harness((images, call) =>
    call === 1 ? [0, 1, 2, 4].map((i) => result(i)) : [result(0, { amount: 77777 })],
  );
  const q = createQueue(h.deps);
  await q.runOnce();
  const r3 = (await receipts.get('r3'))!;
  expect(r3.status).toBe('queued');
  expect(r3.batchSingle).toBe(true);
  expect(r3.amount).toBeNull();
  expect((await receipts.get('r4'))!.amount).toBe(5000);
  await q.runOnce();
  expect(h.calls[1]).toHaveLength(1);
  expect((await receipts.get('r3'))!.amount).toBe(77777);
});

test('single image with no result becomes needs_review with failure warning', async () => {
  await seed(1);
  const h = harness(() => []);
  await createQueue(h.deps).runOnce();
  const r = (await receipts.get('r0'))!;
  expect(r.status).toBe('needs_review');
  expect(r.warnings).toContain(FAILED_WARNING);
});

test('cancellation becomes excluded', async () => {
  await seed(1);
  const h = harness(() => [result(0, { isCancellation: true })]);
  await createQueue(h.deps).runOnce();
  expect((await receipts.get('r0'))!.status).toBe('excluded');
});

test('keeps user-entered site and users and item', async () => {
  await seed(1);
  const r0 = (await receipts.get('r0'))!;
  await receipts.put({ ...r0, site: '현장A', users: ['이영희'], item: '석식' });
  const h = harness(() => [result(0)]);
  await createQueue(h.deps).runOnce();
  const r = (await receipts.get('r0'))!;
  expect(r.site).toBe('현장A');
  expect(r.users).toEqual(['이영희']);
  expect(r.item).toBe('석식');
});

test('quota returns items to queued', async () => {
  await seed(2);
  const h = harness(() => new RecognitionError('quota'));
  expect(await createQueue(h.deps).runOnce()).toBe('quota');
  expect((await receipts.get('r0'))!.status).toBe('queued');
  expect((await receipts.get('r1'))!.status).toBe('queued');
});

test('auth stops and reports auth', async () => {
  await seed(1);
  const h = harness(() => new RecognitionError('auth'));
  expect(await createQueue(h.deps).runOnce()).toBe('auth');
  expect((await receipts.get('r0'))!.status).toBe('queued');
});

test('no key returns no_key without calling', async () => {
  await seed(1);
  const h = harness(allOk);
  h.deps.recognizer = async () => null;
  expect(await createQueue(h.deps).runOnce()).toBe('no_key');
  expect(h.calls).toHaveLength(0);
});

test('offline returns offline without calling', async () => {
  await seed(1);
  const h = harness(allOk);
  h.deps.isOnline = () => false;
  expect(await createQueue(h.deps).runOnce()).toBe('offline');
  expect(h.calls).toHaveLength(0);
});

test('format error retries once then needs_review', async () => {
  await seed(1);
  const h = harness(() => new RecognitionError('format'));
  expect(await createQueue(h.deps).runOnce()).toBe('processed');
  expect(h.calls).toHaveLength(2);
  const r = (await receipts.get('r0'))!;
  expect(r.status).toBe('needs_review');
  expect(r.warnings).toContain(FAILED_WARNING);
});

test('recover resets stuck recognizing items', async () => {
  await seed(1);
  const r0 = (await receipts.get('r0'))!;
  await receipts.put({ ...r0, status: 'recognizing' });
  const q = createQueue(harness(allOk).deps);
  await q.recover();
  expect((await receipts.get('r0'))!.status).toBe('queued');
});

test('start drains the queue and resumes on kick', async () => {
  await seed(2);
  const h = harness(allOk);
  const q = createQueue(h.deps);
  const idle = new Promise<void>((res) => q.onChange((s) => s === 'idle' && res()));
  q.start();
  await idle;
  expect((await receipts.get('r1'))!.status).toBe('needs_review');
  await seed(0);
  await receipts.put({ ...(await receipts.get('r0'))!, id: 'new', status: 'queued' });
  const idle2 = new Promise<void>((res) => q.onChange((s) => s === 'idle' && res()));
  q.kick();
  await idle2;
  q.stop();
  expect((await receipts.get('new'))!.status).toBe('needs_review');
});

// ---- 최종 리뷰 C1: 인식 중 사용자 변경과 겹쳐도 덮어쓰지 않는다
test('a receipt the user confirmed during recognition is not overwritten', async () => {
  await seed(1);
  const { deps } = harness(allOk, async () => {
    const r = (await receipts.get('r0'))!;
    await receipts.put({ ...r, item: '직접입력', status: 'done' });
  });
  await createQueue(deps).runOnce();
  const r = (await receipts.get('r0'))!;
  expect(r.status).toBe('done');
  expect(r.item).toBe('직접입력');
});

test('a receipt deleted during recognition stays deleted', async () => {
  await seed(1);
  const { deps } = harness(allOk, async () => receipts.remove('r0'));
  await createQueue(deps).runOnce();
  expect(await receipts.get('r0')).toBeUndefined();
});

test('values the user typed during recognition win over results', async () => {
  await seed(1);
  const { deps } = harness(allOk, async () => {
    const r = (await receipts.get('r0'))!;
    await receipts.put({ ...r, amount: 777, users: ['이영희'] });
  });
  await createQueue(deps).runOnce();
  const r = (await receipts.get('r0'))!;
  expect(r.amount).toBe(777);
  expect(r.users).toEqual(['이영희']);
  expect(r.merchant).toBe('가게0');
  expect(r.status).toBe('needs_review');
});

// ---- 최종 리뷰 I4: 사진 한 장 준비 실패는 그 영수증만 실패시킨다
test('a photo that fails to prepare fails only its own receipt', async () => {
  await seed(3);
  const { deps, calls } = harness((imgs) => imgs.map((_, i) => result(i)));
  deps.prepare = async (p) => {
    if (p.id === 'p1') throw new Error('decode');
    return p.original!;
  };
  await createQueue(deps).runOnce();
  expect(calls[0]).toHaveLength(2);
  expect((await receipts.get('r1'))!.warnings).toEqual([FAILED_WARNING]);
  expect((await receipts.get('r0'))!.merchant).toBe('가게0');
  expect((await receipts.get('r2'))!.merchant).toBe('가게1');
});

// ---- 최종 리뷰 I2: 서버 과부하(5xx)는 잠깐 뒤 다시 시도한다
test('server errors requeue the batch and report retry', async () => {
  await seed(2);
  const { deps } = harness(() => new RecognitionError('server', '503'));
  expect(await createQueue(deps).runOnce()).toBe('retry');
  expect((await receipts.get('r0'))!.status).toBe('queued');
  expect((await receipts.get('r1'))!.warnings).toEqual([]);
});

// ---- 최종 리뷰 I5: 사용자가 직접 맞춘 자르기는 다시 인식해도 유지한다
test('manually adjusted corners are kept when recognizing again', async () => {
  await seed(1);
  const r = (await receipts.get('r0'))!;
  const manual: Photo = {
    ...r.photos[0],
    corners: [[1, 1], [9, 1], [9, 9], [1, 9]],
    manualCorners: true,
    processed: new Blob(['mine']),
  };
  await receipts.put({ ...r, photos: [manual] });
  const { deps } = harness(allOk);
  let processed = 0;
  deps.process = async (p) => {
    processed++;
    return p;
  };
  await createQueue(deps).runOnce();
  expect(processed).toBe(0);
  expect(await (await receipts.get('r0'))!.photos[0].processed!.text()).toBe('mine');
});

// ---- 최종 리뷰 I2: 온라인인데 네트워크 오류가 나면 타이머로 다시 깨어난다
afterEach(() => vi.useRealTimers());
test('after a network error while online the loop retries on a timer', async () => {
  await seed(1);
  const { deps, calls } = harness((imgs, call) => (call === 1 ? new TypeError('fetch failed') : allOk(imgs)));
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const q = createQueue(deps);
  q.start();
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  await vi.advanceTimersByTimeAsync(61_000);
  await vi.waitFor(() => expect(calls).toHaveLength(2));
  q.stop();
});

// ---- 최종 리뷰 I1: 나중에 열린 화면도 마지막 상태(키 오류·한도)를 알 수 있다
test('status() remembers the last result for screens that mount later', async () => {
  await seed(1);
  const { deps } = harness(() => new RecognitionError('auth', 'bad key'));
  const q = createQueue(deps);
  q.start();
  await vi.waitFor(() => expect(q.status()).toBe('auth'));
  q.stop();
});

// ---- 누운 영수증: 바로 세운 보정본으로 한 번 더 인식한다
test('a sideways receipt is stood upright and recognized again from the upright photo', async () => {
  await seed(1);
  const h = harness((_, call) => (call === 1 ? [result(0, { rotation: 90, amount: 111 })] : [result(0, { amount: 5000 })]));
  const processCalls: unknown[][] = [];
  h.deps.process = async (p, corners, rotation) => {
    processCalls.push([corners, rotation]);
    return { ...p, rotation, processed: new Blob(['upright']) };
  };
  const q = createQueue(h.deps);

  await q.runOnce();
  let r = (await receipts.get('r0'))!;
  expect(r.status).toBe('queued');
  expect(r.batchSingle).toBe(true);
  expect(r.amount).toBeNull(); // 누운 채로 읽은 값은 쓰지 않는다
  expect(r.photos[0].upright).toBe(true);
  expect(r.photos[0].rotation).toBe(90);
  expect(await r.photos[0].processed!.text()).toBe('upright');
  expect(processCalls).toEqual([[null, 90]]);

  await q.runOnce();
  r = (await receipts.get('r0'))!;
  expect(r.status).toBe('needs_review');
  expect(r.amount).toBe(5000);
  expect(processCalls).toHaveLength(1); // 세운 사진 기준 모서리로 원본을 다시 자르지 않는다
  expect(await r.photos[0].processed!.text()).toBe('upright');
  expect(h.calls).toHaveLength(2);
});

test('a receipt that still looks sideways on the second pass is not sent a third time', async () => {
  await seed(1);
  const h = harness(() => [result(0, { rotation: 90 })]);
  const q = createQueue(h.deps);
  await q.runOnce();
  await q.runOnce();
  expect((await receipts.get('r0'))!.status).toBe('needs_review');
  expect(await q.runOnce()).toBe('idle');
  expect(h.calls).toHaveLength(2);
});

test('when the upright photo cannot be made the first reading is used', async () => {
  await seed(1);
  const h = harness(() => [result(0, { rotation: 270, amount: 7000 })]);
  h.deps.process = async () => {
    throw new Error('decode');
  };
  await createQueue(h.deps).runOnce();
  const r = (await receipts.get('r0'))!;
  expect(r.status).toBe('needs_review');
  expect(r.amount).toBe(7000);
  expect(h.calls).toHaveLength(1);
});

test('recognition reads the upright photo once it exists, otherwise the original', () => {
  const original = new Blob(['o']);
  const processed = new Blob(['p']);
  expect(recognitionSource({ id: 'a', original, processed, corners: null })).toBe(original);
  expect(recognitionSource({ id: 'a', original, processed, corners: null, upright: true })).toBe(processed);
  expect(recognitionSource({ id: 'a', original: null, processed, corners: null })).toBe(processed);
});
