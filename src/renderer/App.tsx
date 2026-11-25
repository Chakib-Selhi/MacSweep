import { useState } from 'react';
import type { CategoryPage } from '../shared/categories';
import { Sidebar, type PageId } from './components/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { DuplicatesPage } from './pages/Duplicates';
import { ExplorePage } from './pages/Explore';
import { HistoryPage } from './pages/History';
import { LargeFilesPage } from './pages/LargeFiles';
import { Review } from './pages/Review';
import { SettingsPage } from './pages/SettingsPage';
import { ExploreProvider } from './explore/ExploreContext';
import { ScanProvider } from './scan/ScanContext';

type Page = PageId | 'review';

const PAGE_OF_CATEGORY: Record<CategoryPage, PageId> = {
  'large-files': 'largeFiles',
  duplicates: 'duplicates',
};

export function App() {
  const [page, setPage] = useState<Page>('dashboard');

  return (
    <ScanProvider>
      <ExploreProvider>
        <div className="flex h-full">
          <Sidebar current={page === 'review' ? 'dashboard' : page} onSelect={setPage} />
          <main className="flex min-w-0 flex-1 flex-col">
            <div className="h-13 shrink-0 [-webkit-app-region:drag]" />
            <div className="min-h-0 flex-1">
              {page === 'dashboard' && (
                <Dashboard
                  onReview={() => setPage('review')}
                  onOpenPage={(category) => setPage(PAGE_OF_CATEGORY[category])}
                />
              )}
              {page === 'review' && <Review onBack={() => setPage('dashboard')} />}
              {page === 'explorer' && <ExplorePage />}
              {page === 'largeFiles' && (
                <LargeFilesPage onOpenSettings={() => setPage('settings')} />
              )}
              {page === 'duplicates' && <DuplicatesPage />}
              {page === 'history' && <HistoryPage />}
              {page === 'settings' && <SettingsPage />}
            </div>
          </main>
        </div>
      </ExploreProvider>
    </ScanProvider>
  );
}
