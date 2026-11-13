import { useSyncExternalStore } from 'react';

// 저장 실패(StorageFullError)를 화면 전체에 알리기 위한 작은 전역 상태
let full = false;
const listeners = new Set<() => void>();

export function reportStorageFull(value = true) {
  full = value;
  listeners.forEach((l) => l());
}

export function useStorageFull(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => full,
  );
}
