import { createContext, useContext } from 'react';
import type { Queue } from '../recognition/queue';

export interface AppServices {
  queue: Queue | null;
}

export const AppContext = createContext<AppServices>({ queue: null });

export const useApp = () => useContext(AppContext);
