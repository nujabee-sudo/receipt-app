import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Settings } from '../domain/types';
import { exportBackup, importBackup, lastBackupAt, markBackedUp } from '../backup/backup';
import { shareOrDownload } from '../export/share';
import { receipts } from '../storage/receipts';
import { settings as store } from '../storage/settings';
import { useApp } from './appContext';
import { currentMonth, monthLabel, shiftMonth } from './format';
import { reportStorageFull } from './storageFull';
import { Icon } from './components/Icon';

function Field(props: { label: string; value: string; onChange: (v: string) => void; type?: string; hint?: string; inputMode?: 'numeric' }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        aria-label={props.label}
        type={props.type ?? 'text'}
        inputMode={props.inputMode}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        autoComplete="off"
      />
      {props.hint && <small>{props.hint}</small>}
    </label>
  );
}

export function SettingsPage() {
  const { queue } = useApp();
  const [form, setForm] = useState<Settings | null>(null);
  const [msg, setMsg] = useState('');
  const [usage, setUsage] = useState('');
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [purgeYm, setPurgeYm] = useState(shiftMonth(currentMonth(), -3));
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void store.get().then(setForm);
    void lastBackupAt().then(setLastBackup);
    void navigator.storage?.estimate?.().then((e) => {
      if (e.usage !== undefined) setUsage(`${Math.round(e.usage / 1024 / 1024)}MB 사용 중`);
    });
  }, []);

  if (!form) return <main className="page">불러오는 중…</main>;
  const set = (k: keyof Settings) => (v: string) => setForm({ ...form, [k]: v });
  const cardOk = form.cardLast4 === '' || /^\d{4}$/.test(form.cardLast4);

  const save = async () => {
    await store.save({ ...form, geminiKey: form.geminiKey.trim() });
    queue?.kick();
    setMsg('저장했어요');
  };

  const doExport = async () => {
    const file = await exportBackup(new Date());
    if ((await shareOrDownload(file)) === 'cancelled') return;
    const now = new Date();
    await markBackedUp(now);
    setLastBackup(now.toISOString());
  };

  const doImport = async (f: File | undefined) => {
    if (!f) return;
    try {
      const r = await importBackup(f);
      setMsg(`불러왔어요: 새로 ${r.added}건, 갱신 ${r.updated}건, 건너뜀 ${r.skipped}건`);
      setForm(await store.get());
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const purge = async (mode: 'photos' | 'all') => {
    const what = mode === 'photos' ? '원본 사진(보정본은 남김)' : '영수증 전체';
    if (!confirm(`${monthLabel(purgeYm)}의 ${what}을(를) 지울까요? 되돌릴 수 없어요.`)) return;
    const n = await receipts.purgeMonth(purgeYm, mode);
    reportStorageFull(false);
    setMsg(`${n}건 정리했어요`);
  };

  return (
    <main className="page settings">
      <header className="top-bar">
        <Link to="/" aria-label="뒤로">
          <Icon name="back" />
        </Link>
        <h1>설정</h1>
      </header>

      <section className="card">
        <Field
          label="Gemini API 키"
          type="password"
          value={form.geminiKey}
          onChange={set('geminiKey')}
          hint="Google AI Studio(aistudio.google.com)에서 무료로 발급받을 수 있어요. 이 폰에만 저장돼요."
        />
        <Field label="기본 카드번호 뒷자리" inputMode="numeric" value={form.cardLast4} onChange={set('cardLast4')} />
        {!cardOk && <p className="error">숫자 4자리로 입력해 주세요</p>}
        <Field label="기본 사용자 이름" value={form.defaultUser} onChange={set('defaultUser')} />
        <Field label="기본 차량 이름" value={form.vehicle} onChange={set('vehicle')} hint="예: 쏘렌토 → 주유(쏘렌토)" />
        <label className="field">
          <span>정렬 순서</span>
          <select
            aria-label="정렬 순서"
            value={form.sortOrder}
            onChange={(e) => setForm({ ...form, sortOrder: e.target.value as Settings['sortOrder'] })}
          >
            <option value="desc">최신순</option>
            <option value="asc">오래된순</option>
          </select>
        </label>
        <button className="btn primary" disabled={!cardOk} onClick={save}>
          저장
        </button>
        {msg && <p className="msg">{msg}</p>}
      </section>

      <section className="card">
        <h2>백업</h2>
        <p className="muted">마지막 백업: {lastBackup ? new Date(lastBackup).toLocaleDateString('ko-KR') : '없음'}</p>
        <button className="btn" onClick={doExport}>
          백업 내보내기
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()}>
          백업 불러오기
        </button>
        <input ref={fileRef} type="file" accept=".zip,application/zip" hidden onChange={(e) => doImport(e.target.files?.[0])} />
      </section>

      <section className="card">
        <h2>저장 공간</h2>
        {usage && <p className="muted">{usage}</p>}
        <label className="field">
          <span>정리할 달</span>
          <input aria-label="정리할 달" type="month" value={purgeYm} onChange={(e) => setPurgeYm(e.target.value)} />
        </label>
        <button className="btn" onClick={() => purge('photos')}>
          사진만 지우기
        </button>
        <button className="btn danger" onClick={() => purge('all')}>
          전체 지우기
        </button>
      </section>
    </main>
  );
}
