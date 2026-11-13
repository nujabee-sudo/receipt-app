import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { generateDocs, selectTargets, type GeneratedDocs, type GenerateMode } from '../export/generate';
import { shareOrDownload } from '../export/share';
import { receipts } from '../storage/receipts';
import { currentMonth, dateHeading, monthLabel, won } from './format';
import { useObjectUrl, useSettings } from './hooks';

export function GeneratePage() {
  const [params] = useSearchParams();
  const ym = params.get('ym') ?? currentMonth();
  const nav = useNavigate();
  const s = useSettings();
  const list = useLiveQuery(() => receipts.listByMonth(ym), [ym]);
  const [mode, setMode] = useState<GenerateMode>('month');
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [doc, setDoc] = useState<(GeneratedDocs & { ids: string[] }) | null>(null);
  const pdfUrl = useObjectUrl(doc?.pdf.blob);

  if (!list || !s) return <main className="page">불러오는 중…</main>;
  const { targets, unresolved } = selectTargets(list, mode);
  const total = targets.reduce((sum, r) => sum + (r.amount ?? 0), 0);

  const run = async () => {
    setAsking(false);
    setBusy(true);
    setError('');
    setMsg('');
    try {
      const out = await generateDocs(targets, { ym, settings: s, partial: mode === 'pending' });
      setDoc({ ...out, ids: targets.map((r) => r.id) });
    } catch (e) {
      setError(`문서를 만들지 못했어요: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const start = () => (unresolved.length ? setAsking(true) : void run());

  /** 제출하는 문서는 PDF라서, PDF를 저장·공유했을 때만 '문서 생성 완료'로 기록한다 */
  const send = async (file: { name: string; blob: Blob }, isPdf: boolean) => {
    if (!doc) return;
    const res = await shareOrDownload(file);
    if (res === 'cancelled') return;
    if (isPdf) await receipts.markGenerated(doc.ids, new Date().toISOString());
    setMsg(res === 'shared' ? '공유했어요' : '저장했어요');
  };

  return (
    <main className="page generate">
      <header className="top-bar">
        <Link to="/" className="icon-link" aria-label="뒤로">
          ‹
        </Link>
        <h1>{monthLabel(ym)} 문서 생성</h1>
      </header>

      {!doc && (
        <>
          <section className="card" role="radiogroup" aria-label="대상">
            {(
              [
                ['month', '이번 달 전체'],
                ['pending', '아직 문서로 안 만든 것만'],
              ] as const
            ).map(([v, label]) => (
              <label key={v} className="radio">
                <input type="radio" name="mode" value={v} checked={mode === v} onChange={() => setMode(v)} />
                {label}
              </label>
            ))}
          </section>
          <section className="summary">
            {targets.length ? (
              <>
                <strong>{won(total)}</strong>
                <span>{targets.length}건</span>
              </>
            ) : (
              <span>만들 영수증이 없어요</span>
            )}
          </section>
          {error && <p className="error">{error}</p>}
          <nav className="bottom-bar">
            <button className="btn primary" disabled={!targets.length || busy} onClick={start}>
              {busy ? '만드는 중…' : '문서 만들기'}
            </button>
          </nav>
        </>
      )}

      {asking && (
        <div className="dialog-backdrop">
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="unresolved-title">
            <h2 id="unresolved-title">확인이 끝나지 않은 영수증이 있어요</h2>
            <ul>
              {unresolved.map((r) => (
                <li key={r.id}>
                  {r.date ? dateHeading(r.date) : '날짜 없음'} · {r.merchant ?? '가맹점 없음'} · {won(r.amount)}
                </li>
              ))}
            </ul>
            <div className="row-buttons">
              <button className="btn" onClick={() => nav(`/review/${unresolved[0].id}`)}>
                돌아가서 확인
              </button>
              <button className="btn primary" onClick={() => void run()}>
                그래도 진행
              </button>
            </div>
          </div>
        </div>
      )}

      {doc && (
        <>
          {doc.skippedPhotos > 0 && (
            <p className="banner banner-warn">열 수 없는 사진 {doc.skippedPhotos}장은 문서에서 빠졌어요.</p>
          )}
          {pdfUrl && (
            <>
              <iframe className="pdf-preview" title="PDF 미리보기" src={pdfUrl} />
              <a className="link" href={pdfUrl} target="_blank" rel="noreferrer">
                새 탭에서 보기
              </a>
            </>
          )}
          {msg && <p className="msg">{msg}</p>}
          <nav className="bottom-bar">
            <button className="btn" onClick={() => send(doc.xlsx, false)}>
              엑셀 저장/공유
            </button>
            <button className="btn primary" onClick={() => send(doc.pdf, true)}>
              PDF 저장/공유
            </button>
          </nav>
        </>
      )}
    </main>
  );
}
