import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ingestFiles } from '../ingest/ingest';
import { presets } from '../storage/presets';
import { StorageFullError } from '../storage/receipts';
import { useApp } from './appContext';
import { AutoComplete } from './components/AutoComplete';
import { useSettings } from './hooks';
import { reportStorageFull } from './storageFull';

const SITE_KEY = 'capture-site';
const readSite = () => {
  try {
    return localStorage.getItem(SITE_KEY) ?? '';
  } catch {
    return '';
  }
};

export function CapturePage() {
  const { queue } = useApp();
  const s = useSettings();
  const [site, setSite] = useState(readSite);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string[]>([]);
  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);
  const now = new Date().toISOString();
  const siteOpts = useLiveQuery(() => presets.list('site', now), [], []);

  useEffect(() => {
    try {
      localStorage.setItem(SITE_KEY, site);
    } catch {
      /* 저장 못 해도 동작에는 문제없음 */
    }
  }, [site]);

  const onFiles = async (input: HTMLInputElement) => {
    const files = Array.from(input.files ?? []);
    input.value = ''; // 바로 다음 촬영이 되게 비운다
    if (!files.length) return;
    setBusy(true);
    try {
      const { resizeJpeg } = await import('../imaging/browser');
      const res = await ingestFiles(files, {
        site,
        defaultUser: s?.defaultUser ?? '',
        resize: (b) => resizeJpeg(b, 2400, 0.9),
      });
      setCount((c) => c + res.added.length);
      setFailed(res.failed.map((f) => `${f.name}: ${f.message}`));
      if (res.failed.some((f) => f.message === new StorageFullError().message)) reportStorageFull(true);
      if (res.added.length) queue?.kick();
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page capture">
      <header className="top-bar">
        <Link to="/" className="icon-link" aria-label="뒤로">
          ‹
        </Link>
        <h1>영수증 촬영</h1>
      </header>

      <section className="card">
        <AutoComplete label="현장" value={site} options={siteOpts} onChange={setSite} placeholder="이번에 찍을 영수증의 현장" />
        <small className="muted">여기서 고른 현장이 새로 찍는 영수증에 미리 들어가요.</small>
      </section>

      <section className="capture-actions">
        <button className="btn primary big" disabled={busy} onClick={() => camRef.current?.click()}>
          📷 촬영
        </button>
        <button className="btn" disabled={busy} onClick={() => galRef.current?.click()}>
          앨범에서 고르기
        </button>
        <input
          ref={camRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          aria-label="카메라로 촬영"
          onChange={(e) => onFiles(e.currentTarget)}
        />
        <input
          ref={galRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          aria-label="앨범에서 사진 선택"
          onChange={(e) => onFiles(e.currentTarget)}
        />
      </section>

      <p className="counter" aria-live="polite">
        {busy ? '저장하는 중…' : `이번에 ${count}장 등록했어요`}
      </p>
      {failed.length > 0 && (
        <ul className="warnings" role="alert">
          {failed.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}

      <nav className="bottom-bar">
        <Link to="/" className="btn primary">
          완료
        </Link>
      </nav>
    </main>
  );
}
