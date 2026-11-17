import { suggestItem } from '../domain/content';
import type { Photo, Receipt, Rotation } from '../domain/types';
import { validateReceipt } from '../domain/validate';
import { db } from '../storage/db';
import { receipts } from '../storage/receipts';
import { settings as settingsStore } from '../storage/settings';
import type { Recognizer } from './recognizer';
import { RecognitionError, type Corners, type RecognitionResult } from './schema';

export const BATCH_SIZE = 5;
export const MIN_INTERVAL_MS = 7000;
export const QUOTA_RETRY_MS = 10 * 60 * 1000;
/** 서버 과부하나 온라인 상태에서의 네트워크 오류 뒤 다시 시도할 때까지 */
export const RETRY_MS = 60 * 1000;
export const FAILED_WARNING = '자동 인식에 실패했어요. 직접 입력해 주세요';

export interface QueueDeps {
  /** 설정에 키가 없으면 null */
  recognizer: () => Promise<Recognizer | null>;
  /** 인식용 1600px JPEG */
  prepare: (p: Photo) => Promise<Blob>;
  /** corners(0~1000 정규화)로 펴고 rotation만큼 돌려 보정본을 만든 Photo를 돌려준다 */
  process: (p: Photo, corners: Corners | null, rotation: Rotation) => Promise<Photo>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  isOnline: () => boolean;
  /** 'YYYY-MM-DD' */
  today: () => string;
}

/** 인식에 보낼 사진: 누운 영수증을 바로 세운 보정본이 있으면 그것, 아니면 원본 */
export function recognitionSource(p: Photo): Blob {
  return (p.upright && p.processed ? p.processed : (p.original ?? p.processed))!;
}

export type RunResult ='idle' | 'processed' | 'no_key' | 'auth' | 'quota' | 'offline' | 'retry';

export function createQueue(deps: QueueDeps) {
  let lastRequestAt = -Infinity;
  let last: RunResult = 'idle';
  const listeners = new Set<(s: RunResult) => void>();
  const emit = (s: RunResult) => {
    last = s;
    listeners.forEach((cb) => cb(s));
  };

  const isoNow = () => new Date().toISOString();

  /**
   * 인식 도중 사용자가 고치거나 확인·삭제했을 수 있으므로, 쓰기 직전에 최신 기록을 다시 읽는다.
   * 지워졌거나 더 이상 recognizing이 아니면(사용자가 확인함) 건드리지 않는다.
   */
  async function updateIfRecognizing(id: string, change: (fresh: Receipt, all: Receipt[]) => Receipt) {
    await db.transaction('rw', db.receipts, async () => {
      const fresh = await db.receipts.get(id);
      if (!fresh || fresh.status !== 'recognizing') return;
      await db.receipts.put({ ...change(fresh, await db.receipts.toArray()), updatedAt: isoNow() });
    });
  }

  const requeue = (r: Receipt, batchSingle?: boolean) =>
    updateIfRecognizing(r.id, (f) => ({ ...f, status: 'queued', ...(batchSingle ? { batchSingle } : {}) }));

  const fail = (r: Receipt) =>
    updateIfRecognizing(r.id, (f) => ({ ...f, status: 'needs_review', warnings: [FAILED_WARNING], batchSingle: undefined }));

  async function pickBatch(): Promise<Receipt[]> {
    const queued = (await receipts.listByStatus(['queued'])).sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    if (queued.length === 0) return [];
    if (queued[0].batchSingle) return [queued[0]];
    return queued.filter((r) => !r.batchSingle).slice(0, BATCH_SIZE);
  }

  async function recognizeWithRetry(rec: Recognizer, images: Blob[]): Promise<RecognitionResult[] | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const wait = lastRequestAt + MIN_INTERVAL_MS - deps.now();
      if (wait > 0) await deps.sleep(wait);
      lastRequestAt = deps.now();
      try {
        return await rec.recognize(images);
      } catch (e) {
        if (e instanceof RecognitionError && e.kind === 'format') continue;
        throw e;
      }
    }
    return null;
  }

  async function apply(r: Receipt, res: RecognitionResult) {
    const s = await settingsStore.get();
    const first = r.photos[0];
    // 보정(이미지 처리)은 트랜잭션 밖에서 미리 한다. 사용자가 직접 맞춘 자르기는 유지한다.
    // 이미 바로 세운 보정본으로 읽은 결과라면 모서리가 보정본 기준이므로 원본을 다시 자르지 않는다.
    let processed: Photo | null = null;
    if (first && !first.manualCorners && !first.upright) {
      try {
        processed = await deps.process(first, res.corners, res.rotation);
      } catch {
        /* 보정 실패 시 원본으로 계속 */
      }
    }
    // 누운 영수증: 누운 채로 읽은 값은 버리고, 바로 세운 보정본으로 한 번만 더 읽는다
    // (원본이 지워져 새 보정본을 못 만든 경우는 제외)
    if (processed?.processed && processed.processed !== first.processed && res.rotation !== 0 && !res.isCancellation) {
      const upright: Photo = { ...processed, upright: true };
      await updateIfRecognizing(r.id, (f) => {
        const same = f.photos[0]?.id === upright.id && !f.photos[0].manualCorners;
        // 그사이 사용자가 자르기를 직접 맞췄으면 그 사진을 두고 다시 읽는다 (그때는 보정을 건너뛰어 반복되지 않는다)
        const photos = same ? [upright, ...f.photos.slice(1)] : f.photos;
        return { ...f, photos, status: 'queued', batchSingle: true };
      });
      return;
    }
    await updateIfRecognizing(r.id, (f, all) => {
      const photos =
        processed && f.photos[0]?.id === processed.id && !f.photos[0].manualCorners
          ? [processed, ...f.photos.slice(1)]
          : f.photos;
      // 비어 있는 칸만 채운다 (인식 중에 사용자가 입력한 값이 이긴다)
      const next: Receipt = {
        ...f,
        date: f.date ?? res.date,
        time: f.time ?? res.time,
        amount: f.amount ?? res.amount,
        cardLast4: f.cardLast4 ?? res.cardLast4,
        merchant: f.merchant ?? res.merchant,
        approvalNo: f.approvalNo ?? res.approvalNo,
        item: f.item.trim() ? f.item : suggestItem(res.category, f.time ?? res.time, s.vehicle),
        isCancellation: res.isCancellation,
        photos,
        batchSingle: undefined,
      };
      if (res.isCancellation) return { ...next, status: 'excluded', warnings: [] };
      const warnings = validateReceipt(next, { today: deps.today(), cardLast4: s.cardLast4, others: all });
      return { ...next, status: 'needs_review', warnings };
    });
  }

  async function runOnce(): Promise<RunResult> {
    if (!deps.isOnline()) return 'offline';
    const rec = await deps.recognizer();
    if (!rec) return 'no_key';
    const batch = await pickBatch();
    if (batch.length === 0) return 'idle';

    for (const r of batch) await receipts.put({ ...r, status: 'recognizing', updatedAt: isoNow() });

    // 사진마다 따로 준비한다. 한 장이 실패해도 그 영수증만 실패로 둔다.
    const ready: { r: Receipt; image: Blob }[] = [];
    for (const r of batch) {
      try {
        const p = r.photos[0];
        if (!p || (!p.original && !p.processed)) throw new Error('사진 없음');
        ready.push({ r, image: await deps.prepare(p) });
      } catch {
        await fail(r);
      }
    }
    if (ready.length === 0) return 'processed';

    let results: RecognitionResult[] | null;
    try {
      results = await recognizeWithRetry(
        rec,
        ready.map((x) => x.image),
      );
    } catch (e) {
      for (const { r } of ready) await requeue(r);
      const kind = e instanceof RecognitionError ? e.kind : 'network';
      if (kind === 'quota' || kind === 'auth') return kind;
      if (kind === 'server') return 'retry';
      return 'offline';
    }

    const byIndex = new Map((results ?? []).map((x) => [x.index, x]));
    for (let i = 0; i < ready.length; i++) {
      const { r } = ready[i];
      const res = byIndex.get(i);
      if (res) await apply(r, res);
      else if (ready.length > 1 && results !== null) await requeue(r, true);
      else await fail(r);
    }
    return 'processed';
  }

  // ---- 백그라운드 루프 ----
  let running = false;
  let wake: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const waitWake = (ms?: number) =>
    new Promise<void>((resolve) => {
      wake = () => {
        wake = null;
        if (timer) clearTimeout(timer);
        timer = null;
        resolve();
      };
      if (ms) timer = setTimeout(() => wake?.(), ms);
    });

  function retryDelay(s: RunResult): number | undefined {
    if (s === 'quota') return QUOTA_RETRY_MS;
    if (s === 'retry') return RETRY_MS;
    // 'online' 이벤트는 이미 온라인이면 오지 않으므로, 온라인인데 실패했으면 타이머로도 깨운다
    if (s === 'offline' && deps.isOnline()) return RETRY_MS;
    return undefined;
  }

  async function loop() {
    while (running) {
      let s: RunResult;
      try {
        s = await runOnce();
      } catch {
        s = 'idle';
      }
      emit(s);
      if (!running) break;
      if (s === 'processed') continue;
      await waitWake(retryDelay(s));
    }
  }

  function kick() {
    wake?.();
  }

  return {
    runOnce,
    /** 앱이 종료되며 recognizing에 남은 건을 queued로 되돌린다 */
    async recover() {
      for (const r of await receipts.listByStatus(['recognizing']))
        await receipts.put({ ...r, status: 'queued', updatedAt: isoNow() });
    },
    start() {
      if (running) return;
      running = true;
      if (typeof window !== 'undefined') window.addEventListener('online', kick);
      void this.recover().then(loop);
    },
    stop() {
      running = false;
      if (typeof window !== 'undefined') window.removeEventListener('online', kick);
      kick();
    },
    /** 새 영수증 등록, 설정 저장 시 호출 */
    kick,
    /** 마지막 실행 결과 (키 오류·한도 초과 안내용) */
    status: (): RunResult => last,
    onChange(cb: (s: RunResult) => void): () => void {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

export type Queue = ReturnType<typeof createQueue>;
