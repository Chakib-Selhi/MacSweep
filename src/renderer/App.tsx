import { useState } from 'react';
import { Sidebar, type PageId } from './components/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { HistoryPage } from './pages/History';
import { Placeholder } from './pages/Placeholder';
import { Review } from './pages/Review';
import { ScanProvider } from './scan/ScanContext';

type Page = PageId | 'review';
type UpcomingPage = Exclude<PageId, 'dashboard' | 'history'>;

const MILESTONE_BY_PAGE: Record<UpcomingPage, string> = {
  largeFiles: 'M5',
  duplicates: 'M5',
  settings: 'M5',
};

export function App() {
  const [page, setPage] = useState<Page>('dashboard');

  return (
    <ScanProvider>
      <div className="flex h-full">
        <Sidebar current={page === 'review' ? 'dashboard' : page} onSelect={setPage} />
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="h-13 shrink-0 [-webkit-app-region:drag]" />
          <div className="min-h-0 flex-1">
            {page === 'dashboard' && <Dashboard onReview={() => setPage('review')} />}
            {page === 'review' && <Review onBack={() => setPage('dashboard')} />}
            {page === 'history' && <HistoryPage />}
            {page !== 'dashboard' && page !== 'review' && page !== 'history' && (
              <div className="px-8">
                <Placeholder page={page} milestone={MILESTONE_BY_PAGE[page]} />
              </div>
            )}
          </div>
        </main>
      </div>
    </ScanProvider>
  );
}
