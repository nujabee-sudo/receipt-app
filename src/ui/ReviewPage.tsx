import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { composeContent } from '../domain/content';
import type { Photo, Pt, Receipt } from '../domain/types';
import { W } from '../domain/validate';
import { confirmReceipt, nextToReview } from '../ingest/ingest';
import { presets } from '../storage/presets';
import { receipts } from '../storage/receipts';
import { useApp } from './appContext';
import { AutoComplete } from './components/AutoComplete';
import { Thumb } from './components/Thumb';
import { UserChips } from './components/UserChips';
import { CornerEditor } from './CornerEditor';
import { newId } from './format';

interface Form {
  date: string;
  time: string;
  amount: string;
  cardLast4: string;
  merchant: string;
  site: string;
  item: string;
  users: string[];
}

const toForm = (r: Receipt): Form => ({
  date: r.date ?? '',
  time: r.time ?? '',
  amount: r.amount === null ? '' : r.amount.toLocaleString('ko-KR'),
  cardLast4: r.cardLast4 ?? '',
  merchant: r.merchant ?? '',
  site: r.site,
  item: r.item,
  users: r.users,
});

function parseAmount(s: string): number | null {
  const digits = s.replace(/[^\d-]/g, '');
  if (!digits || digits === '-') return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

const or = (s: string) => (s.trim() ? s.trim() : null);

/** 영수증이 바뀌면 화면 상태를 통째로 새로 만든다 (이전 영수증 값이 다음 영수증에 저장되지 않게) */
export function ReviewPage() {
  const { id = '' } = useParams();
  return <ReviewForm key={id} id={id} />;
}

/** 화면에서 고친 칸만 영수증 값으로 바꾼다 (고치지 않은 칸은 저장소의 최신 값을 그대로 둔다) */
function editedFields(edits: Partial<Form>): Partial<Receipt> {
  const out: Partial<Receipt> = {};
  if ('date' in edits) out.date = or(edits.date!);
  if ('time' in edits) out.time = or(edits.time!);
  if ('amount' in edits) out.amount = parseAmount(edits.amount!);
  if ('cardLast4' in edits) out.cardLast4 = or(edits.cardLast4!);
  if ('merchant' in edits) out.merchant = or(edits.merchant!);
  if ('site' in edits) out.site = edits.site!.trim();
  if ('item' in edits) out.item = edits.item!.trim();
  if ('users' in edits) out.users = edits.users!;
  return out;
}

function ReviewForm({ id }: { id: string }) {
  const nav = useNavigate();
  const { queue } = useApp();
  // 인식 대기열이 결과를 쓰면 화면에도 바로 반영되도록 저장소를 구독한다
  const live = useLiveQuery(() => receipts.get(id).then((x) => x ?? null), [id]);
  const [edits, setEdits] = useState<Partial<Form>>({});
  const [shownWarnings, setShownWarnings] = useState<string[] | null>(null);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const addRef = useRef<HTMLInputElement>(null);
  const now = new Date().toISOString();
  const siteOpts = useLiveQuery(() => presets.list('site', now), [], []);
  const itemOpts = useLiveQuery(() => presets.list('item', now), [], []);
  const userOpts = useLiveQuery(() => presets.list('user', now), [], []);

  if (live === undefined) return <main className="page">불러오는 중…</main>;
  if (live === null) return <main className="page">영수증을 찾을 수 없어요.</main>;
  const r = live;
  const form: Form = { ...toForm(r), ...edits };
  const warnings = shownWarnings ?? r.warnings;

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setEdits((e) => ({ ...e, [k]: v }));

  /** 고친 칸만 최신 기록 위에 저장한다 */
  const persist = async (patch: Partial<Receipt> | ((fresh: Receipt) => Partial<Receipt>) = {}): Promise<void> => {
    const fresh = await receipts.get(id);
    if (!fresh) return;
    await receipts.put({
      ...fresh,
      ...editedFields(edits),
      ...(typeof patch === 'function' ? patch(fresh) : patch),
      updatedAt: new Date().toISOString(),
    });
  };

  const confirm = async (allowDuplicate = false) => {
    setBusy(true);
    try {
      await persist();
      const res = await confirmReceipt(id, { allowDuplicate });
      if (!res.ok) {
        setShownWarnings(res.warnings);
        return;
      }
      const next = await nextToReview(id);
      nav(next ? `/review/${next}` : '/');
    } finally {
      setBusy(false);
    }
  };

  const saveCorners = async (q: [Pt, Pt, Pt, Pt]) => {
    const p = r.photos[photoIdx];
    if (!p?.original) return;
    const { processPhoto } = await import('../imaging/browser');
    const processed = await processPhoto(p.original, q);
    await persist((fresh) => ({
      photos: fresh.photos.map((x) => (x.id === p.id ? { ...x, corners: q, processed, manualCorners: true } : x)),
    }));
    setEditing(false);
  };

  const addPhoto = async (f: File | undefined) => {
    if (!f) return;
    const { processPhoto, resizeJpeg } = await import('../imaging/browser');
    try {
      const original = await resizeJpeg(f, 2400, 0.9);
      const photo: Photo = { id: newId(), original, processed: await processPhoto(original, null), corners: null };
      await persist((fresh) => ({ photos: [...fresh.photos, photo] }));
      setPhotoIdx(r.photos.length);
    } catch (e) {
      setShownWarnings([(e as Error).message]);
    }
  };

  /** 잘못 읽은 값을 다시 읽도록, 영수증에서 읽은 칸을 비우고 대기열에 넣는다 (현장·항목·사용자는 유지) */
  const recognizeAgain = async () => {
    await persist({
      status: 'queued',
      batchSingle: true,
      warnings: [],
      date: null,
      time: null,
      amount: null,
      cardLast4: null,
      merchant: null,
      approvalNo: null,
    });
    queue?.kick();
    nav('/');
  };

  const remove = async () => {
    if (!window.confirm('이 영수증을 삭제할까요? 되돌릴 수 없어요.')) return;
    await receipts.remove(id);
    nav('/');
  };

  const photo = r.photos[photoIdx];
  const onlyDuplicate = warnings.length > 0 && warnings.every((w) => w === W.duplicate);
  const content = composeContent(form.site, form.item);

  return (
    <main className="page review">
      <header className="top-bar">
        <button
          className="icon-link"
          aria-label="뒤로"
          onClick={async () => {
            await persist();
            nav('/');
          }}
        >
          ‹
        </button>
        <h1>영수증 확인</h1>
      </header>

      {editing && photo?.original ? (
        <CornerEditor original={photo.original} initial={photo.corners} onSave={saveCorners} onCancel={() => setEditing(false)} />
      ) : (
        <section className="photo-box">
          <Thumb photo={photo} className="photo-large" />
          {r.photos.length > 1 && (
            <div className="photo-tabs">
              {r.photos.map((p, i) => (
                <button key={p.id} className={i === photoIdx ? 'on' : ''} onClick={() => setPhotoIdx(i)}>
                  {i + 1}
                </button>
              ))}
            </div>
          )}
          <div className="row-buttons small">
            {photo?.original && (
              <button className="btn" onClick={() => setEditing(true)}>
                자르기 조정
              </button>
            )}
            <button className="btn" onClick={() => addRef.current?.click()}>
              사진 추가
            </button>
            <input ref={addRef} type="file" accept="image/*" hidden onChange={(e) => addPhoto(e.target.files?.[0])} />
          </div>
        </section>
      )}

      {r.status === 'queued' || r.status === 'recognizing' ? <p className="muted">⏳ 자동 인식 중이에요. 직접 입력해도 돼요.</p> : null}

      {warnings.length > 0 && (
        <ul className="warnings" role="alert">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <section className="card">
        <div className="two">
          <label className="field">
            <span>일자</span>
            <input aria-label="일자" type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
          </label>
          <label className="field">
            <span>시각</span>
            <input aria-label="시각" type="time" value={form.time} onChange={(e) => set('time', e.target.value)} />
          </label>
        </div>
        <div className="two">
          <label className="field">
            <span>금액</span>
            <input aria-label="금액" inputMode="numeric" value={form.amount} onChange={(e) => set('amount', e.target.value)} />
          </label>
          <label className="field">
            <span>카드번호 뒷자리</span>
            <input aria-label="카드번호 뒷자리" inputMode="numeric" value={form.cardLast4} onChange={(e) => set('cardLast4', e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span>가맹점</span>
          <input aria-label="가맹점" value={form.merchant} onChange={(e) => set('merchant', e.target.value)} />
        </label>
        <AutoComplete label="현장" value={form.site} options={siteOpts} onChange={(v) => set('site', v)} />
        <AutoComplete label="항목" value={form.item} options={itemOpts} onChange={(v) => set('item', v)} placeholder="예: 중식, 주유(쏘렌토)" />
        <div className="preview">
          <span>내용</span>
          <strong>{content || '—'}</strong>
        </div>
        <UserChips users={form.users} options={userOpts} onChange={(u) => set('users', u)} />
      </section>

      <div className="row-buttons small">
        <button className="btn" onClick={recognizeAgain}>
          다시 인식
        </button>
        <button className="btn danger" onClick={remove}>
          삭제
        </button>
      </div>

      <nav className="bottom-bar">
        {onlyDuplicate && (
          <button className="btn" disabled={busy} onClick={() => confirm(true)}>
            그래도 확인
          </button>
        )}
        <button className="btn primary" disabled={busy} onClick={() => confirm(false)}>
          확인
        </button>
      </nav>
    </main>
  );
}
