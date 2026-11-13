import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { composeContent } from '../domain/content';
import { sortReceipts } from '../domain/sort';
import type { Receipt } from '../domain/types';
import { needsBackupReminder } from '../backup/backup';
import { receipts as store } from '../storage/receipts';
import { Banner } from './components/Banner';
import { Thumb } from './components/Thumb';
import { currentMonth, dateHeading, monthLabel, shiftMonth, won } from './format';
import { useApp } from './appContext';
import { useQueueStatus, useSettings } from './hooks';
import { useStorageFull } from './storageFull';

function StatusIcon({ r }: { r: Receipt }) {
  if (r.status === 'queued' || r.status === 'recognizing')
    return (
      <span className="status" aria-label="인식 중">
        ⏳
      </span>
    );
  if (r.status === 'needs_review')
    return (
      <span className="status warn" aria-label="확인 필요">
        ⚠
      </span>
    );
  if (r.generatedAt)
    return (
      <span className="status ok" aria-label="문서 생성 완료">
        ✓
      </span>
    );
  return null;
}

function Row({ r }: { r: Receipt }) {
  const content = composeContent(r.site, r.item);
  return (
    <li>
      <Link className="row" to={`/review/${r.id}`}>
        <Thumb photo={r.photos[0]} />
        <span className="row-main">
          <span className="row-amount">{won(r.amount)}</span>
          <span className="row-sub">{content || r.merchant || '내용 없음'}</span>
        </span>
        <StatusIcon r={r} />
      </Link>
    </li>
  );
}

function groupByDate(list: Receipt[]): [string | null, Receipt[]][] {
  const out: [string | null, Receipt[]][] = [];
  for (const r of list) {
    const last = out[out.length - 1];
    if (last && last[0] === r.date) last[1].push(r);
    else out.push([r.date, [r]]);
  }
  return out;
}

export function HomePage({ initialMonth }: { initialMonth?: string }) {
  const [ym, setYm] = useState(initialMonth ?? currentMonth());
  const [showExcluded, setShowExcluded] = useState(false);
  const s = useSettings();
  const all = useLiveQuery(() => store.listByMonth(ym), [ym]);
  const remind = useLiveQuery(() => needsBackupReminder(new Date()), [all?.length]);
  const storageFull = useStorageFull();
  const queueStatus = useQueueStatus(useApp().queue);

  const sorted = sortReceipts(all ?? [], s?.sortOrder ?? 'desc');
  const active = sorted.filter((r) => r.status !== 'excluded');
  const excluded = sorted.filter((r) => r.status === 'excluded');
  const total = active.reduce((a, r) => a + (r.amount ?? 0), 0);

  return (
    <main className="page home">
      <header className="month-bar">
        <button aria-label="이전 달" onClick={() => setYm(shiftMonth(ym, -1))}>
          ◀
        </button>
        <h1>{monthLabel(ym)}</h1>
        <button aria-label="다음 달" onClick={() => setYm(shiftMonth(ym, 1))}>
          ▶
        </button>
        <Link className="icon-link" to="/settings" aria-label="설정">
          ⚙
        </Link>
      </header>

      <section className="summary">
        <strong>{won(total)}</strong>
        <span>{active.length}건</span>
      </section>

      {s && !s.geminiKey && <Banner to="/settings">설정에서 Gemini API 키를 입력해 주세요</Banner>}
      {s?.geminiKey && queueStatus === 'auth' && (
        <Banner to="/settings">Gemini API 키가 올바르지 않아요. 설정에서 키를 확인해 주세요</Banner>
      )}
      {queueStatus === 'quota' && (
        <Banner tone="info">오늘 무료 인식 한도를 다 썼어요. 잠시 뒤 자동으로 다시 시도해요 (직접 입력해도 돼요)</Banner>
      )}
      {storageFull && <Banner to="/settings">저장 공간이 부족해요. 백업 후 오래된 달을 정리해 주세요</Banner>}
      {remind && (
        <Banner to="/settings" tone="info">
          백업한 지 30일이 지났어요
        </Banner>
      )}

      {all && active.length === 0 && <p className="empty">아직 영수증이 없어요. 아래 [촬영]으로 시작하세요.</p>}

      {groupByDate(active).map(([date, list]) => (
        <section key={date ?? 'none'} className="day">
          <h3>{dateHeading(date)}</h3>
          <ul>
            {list.map((r) => (
              <Row key={r.id} r={r} />
            ))}
          </ul>
        </section>
      ))}

      {excluded.length > 0 && (
        <section className="excluded">
          <button className="link" onClick={() => setShowExcluded(!showExcluded)}>
            제외됨 ({excluded.length})
          </button>
          {showExcluded && (
            <ul>
              {excluded.map((r) => (
                <Row key={r.id} r={r} />
              ))}
            </ul>
          )}
        </section>
      )}

      <nav className="bottom-bar">
        <Link className="btn primary" to="/capture">
          촬영
        </Link>
        <Link className="btn" to={`/generate?ym=${ym}`}>
          문서 생성
        </Link>
      </nav>
    </main>
  );
}
