import { useEffect, useMemo } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { createAppQueue } from './services';
import { requestPersistence } from './storage/db';
import { AppContext } from './ui/appContext';
import { CapturePage } from './ui/CapturePage';
import { GeneratePage } from './ui/GeneratePage';
import { HomePage } from './ui/HomePage';
import { ReviewPage } from './ui/ReviewPage';
import { SettingsPage } from './ui/SettingsPage';

export function App() {
  const queue = useMemo(() => createAppQueue(), []);
  useEffect(() => {
    void requestPersistence();
    queue.start();
    return () => queue.stop();
  }, [queue]);

  return (
    <AppContext.Provider value={{ queue }}>
      <HashRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/capture" element={<CapturePage />} />
          <Route path="/review/:id" element={<ReviewPage />} />
          <Route path="/generate" element={<GeneratePage />} />
        </Routes>
      </HashRouter>
    </AppContext.Provider>
  );
}
