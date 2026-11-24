import { useState } from 'react';
import { Sidebar, type PageId } from './components/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { Placeholder } from './pages/Placeholder';

const MILESTONE_BY_PAGE: Record<Exclude<PageId, 'dashboard'>, string> = {
  largeFiles: 'M5',
  duplicates: 'M5',
  history: 'M4',
  settings: 'M5',
};

export function App() {
  const [page, setPage] = useState<PageId>('dashboard');

  return (
    <div className="flex h-full">
      <Sidebar current={page} onSelect={setPage} />
      <main className="flex-1 overflow-y-auto">
        <div className="h-13 [-webkit-app-region:drag]" />
        <div className="px-8 pb-8">
          {page === 'dashboard' ? (
            <Dashboard />
          ) : (
            <Placeholder page={page} milestone={MILESTONE_BY_PAGE[page]} />
          )}
        </div>
      </main>
    </div>
  );
}
