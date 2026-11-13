import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Settings } from '../domain/types';
import { settings } from '../storage/settings';
import type { Queue, RunResult } from '../recognition/queue';

export function useSettings(): Settings | undefined {
  return useLiveQuery(() => settings.get(), []);
}

/** Blob → object URL (언마운트 시 해제) */
export function useObjectUrl(blob: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

/** 인식 대기열의 마지막 실행 결과 (키 오류·한도 초과 안내용) */
export function useQueueStatus(queue: Queue | null): RunResult {
  const [status, setStatus] = useState<RunResult>(() => queue?.status() ?? 'idle');
  useEffect(() => {
    if (!queue) return;
    setStatus(queue.status());
    return queue.onChange(setStatus);
  }, [queue]);
  return status;
}
