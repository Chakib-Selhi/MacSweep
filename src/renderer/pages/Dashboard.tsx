import { useEffect, useMemo, useState } from 'react';
import { CATEGORY_META, type CategoryPage } from '../../shared/categories';
import type { DiskInfo, ScanDone, ScanProgress } from '../../shared/types';
import { CategoryChart } from '../components/CategoryChart';
import { DiskAccessBanner } from '../components/DiskAccessBanner';
import { RiskBadge } from '../components/RiskBadge';
import { buttonStyles, cardStyle } from '../components/ui';
import { formatBytes, formatDuration, percentOf } from '../format';
import { useScan } from '../scan/ScanContext';
import { categorySelection } from '../scan/selection';
import { strings } from '../strings';

const numberFormat = new Intl.NumberFormat('fr-FR');

interface DashboardProps {
  onReview: () => void;
  onOpenPage: (page: CategoryPage) => void;
}

export function Dashboard({ onReview, onOpenPage }: DashboardProps) {
  const scan = useScan();
  const showResults = scan.result !== null && scan.phase !== 'running';

  return (
    <div className="h-full overflow-y-auto px-8 pb-8">
      <header className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{strings.nav.dashboard}</h1>
        <ScanButton />
      </header>

      <div className="flex max-w-4xl flex-col gap-6">
        <DiskAccessBanner />
        <DiskCard />
        {scan.error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {scan.error}
          </p>
        )}
        {scan.phase === 'idle' && !scan.result && (
          <p className="text-neutral-600 dark:text-neutral-400">{strings.scan.intro}</p>
        )}
        {scan.phase === 'running' && <LiveProgress progress={scan.progress} />}
        {showResults && scan.result && (
          <Results result={scan.result} onReview={onReview} onOpenPage={onOpenPage} />
        )}
      </div>
    </div>
  );
}

function ScanButton() {
  const scan = useScan();
  if (scan.phase === 'running') {
    return (
      <button
        type="button"
        onClick={scan.cancel}
        disabled={scan.cancelling}
        className={buttonStyles.secondary}
      >
        {scan.cancelling ? strings.scan.cancelling : strings.scan.cancel}
      </button>
    );
  }
  return (
    <button type="button" onClick={() => void scan.start()} className={buttonStyles.primary}>
      {scan.result ? strings.scan.restart : strings.scan.start}
    </button>
  );
}

type DiskState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; info: DiskInfo };

function DiskCard() {
  const { phase } = useScan();
  const [disk, setDisk] = useState<DiskState>({ status: 'loading' });

  // Read again after each scan: free space is what the user is here for.
  useEffect(() => {
    if (phase === 'running') return;
    let cancelled = false;
    window.macsweep.disk
      .info()
      .then((info) => !cancelled && setDisk({ status: 'ready', info }))
      .catch(() => !cancelled && setDisk({ status: 'error' }));
    return () => {
      cancelled = true;
    };
  }, [phase]);

  return (
    <section className={cardStyle} aria-labelledby="disk-title">
      <h2
        id="disk-title"
        className="mb-3 text-sm font-medium text-neutral-600 dark:text-neutral-400"
      >
        {strings.dashboard.diskTitle}
      </h2>
      {disk.status === 'loading' && <p>{strings.dashboard.loading}</p>}
      {disk.status === 'error' && (
        <p role="alert" className="text-red-700 dark:text-red-400">
          {strings.dashboard.error}
        </p>
      )}
      {disk.status === 'ready' && <DiskGauge info={disk.info} />}
    </section>
  );
}

function DiskGauge({ info }: { info: DiskInfo }) {
  const percent = percentOf(info.usedBytes, info.totalBytes);
  return (
    <div data-testid="disk-gauge">
      <div
        role="meter"
        aria-label={strings.dashboard.usageLabel(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="mb-4 h-3 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"
      >
        <div className="h-full rounded-full bg-blue-600" style={{ width: `${percent}%` }} />
      </div>
      <dl className="grid grid-cols-3 gap-4 text-sm">
        <Stat label={strings.dashboard.used} value={formatBytes(info.usedBytes)} />
        <Stat label={strings.dashboard.free} value={formatBytes(info.freeBytes)} />
        <Stat label={strings.dashboard.total} value={formatBytes(info.totalBytes)} />
      </dl>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-neutral-600 dark:text-neutral-400">{label}</dt>
      <dd className="text-lg font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function LiveProgress({ progress }: { progress: ScanProgress[] }) {
  const current = progress.at(-1);
  return (
    <section className={cardStyle} aria-labelledby="progress-title" data-testid="scan-progress">
      <h2
        id="progress-title"
        className="mb-3 text-sm font-medium text-neutral-600 dark:text-neutral-400"
      >
        {strings.scan.progressTitle}
      </h2>
      <ul
        role="status"
        aria-live="polite"
        className="divide-y divide-neutral-200 text-sm dark:divide-neutral-800"
      >
        {progress.map((p) => (
          <li key={p.categoryId} className="flex items-center gap-3 py-1.5">
            <span className="flex-1">{strings.categories[p.categoryId]}</span>
            <span className="w-28 text-right tabular-nums text-neutral-600 dark:text-neutral-400">
              {strings.scan.filesVisited(numberFormat.format(p.filesVisited))}
            </span>
            <span className="w-20 text-right font-medium tabular-nums">
              {formatBytes(p.bytesFound)}
            </span>
            <span className="w-16 text-right text-xs text-neutral-500">
              {p === current ? strings.scan.inProgress : strings.scan.finished}
            </span>
          </li>
        ))}
      </ul>
      {current?.currentDir && (
        <p className="mt-3 truncate text-xs text-neutral-500" title={current.currentDir}>
          {current.currentDir}
        </p>
      )}
    </section>
  );
}

function Results({ result, onReview, onOpenPage }: { result: ScanDone } & DashboardProps) {
  const { selected } = useScan();
  const totalBytes = result.categories.reduce((sum, c) => sum + c.totalBytes, 0);
  const selections = useMemo(
    () => new Map(result.categories.map((c) => [c.id, categorySelection(c, selected)])),
    [result, selected],
  );

  return (
    <>
      <div data-testid="scan-summary" className="flex flex-col gap-3">
        <p role="status" className="font-medium">
          {strings.scan.summary(
            strings.scan.status[result.status],
            formatBytes(totalBytes),
            formatDuration(result.durationMs),
          )}
        </p>
        {result.error && <p className="text-sm text-red-700 dark:text-red-400">{result.error}</p>}
        {result.deniedCount > 0 && (
          <details className="rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
            <summary className="cursor-pointer">{strings.scan.denied(result.deniedCount)}</summary>
            <ul className="mt-2 max-h-40 overflow-y-auto text-xs">
              {result.deniedDirs.map((dir) => (
                <li key={dir} className="truncate" title={dir}>
                  {dir}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {result.categories.length === 0 ? (
        <p>{strings.scan.empty}</p>
      ) : (
        <>
          <section className={cardStyle} aria-labelledby="chart-title">
            <h2
              id="chart-title"
              className="mb-3 text-sm font-medium text-neutral-600 dark:text-neutral-400"
            >
              {strings.scan.chartTitle}
            </h2>
            <CategoryChart categories={result.categories} />
          </section>

          <section aria-labelledby="categories-title">
            <div className="mb-3 flex items-center justify-between gap-4">
              <h2 id="categories-title" className="text-lg font-semibold">
                {strings.scan.resultsTitle}
              </h2>
              <button type="button" onClick={onReview} className={buttonStyles.primary}>
                {strings.scan.review}
              </button>
            </div>
            <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {result.categories.map((category) => {
                const selection = selections.get(category.id);
                const meta = CATEGORY_META[category.id];
                return (
                  <li
                    key={category.id}
                    data-testid="category-card"
                    data-category={category.id}
                    className={`${cardStyle} flex flex-col gap-2`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-medium">{strings.categories[category.id]}</h3>
                      <RiskBadge risk={CATEGORY_META[category.id].risk} />
                    </div>
                    <p className="text-2xl font-semibold tabular-nums">
                      {formatBytes(category.totalBytes)}
                    </p>
                    <p className="text-sm text-neutral-600 dark:text-neutral-400">
                      {category.id === 'duplicates'
                        ? strings.dashboard2.groups(result.duplicateGroups.length)
                        : strings.scan.items(category.items.length)}
                      {selection &&
                        selection.count > 0 &&
                        ` · ${strings.scan.selectedInCategory(formatBytes(selection.bytes))}`}
                    </p>
                    {meta.infoOnly && (
                      <p className="text-xs text-neutral-500">{strings.dashboard2.infoOnly}</p>
                    )}
                    {meta.page && (
                      <button
                        type="button"
                        onClick={() => onOpenPage(meta.page as CategoryPage)}
                        aria-label={`${strings.dashboard2.open} : ${strings.categories[category.id]}`}
                        className={`${buttonStyles.secondary} self-start`}
                      >
                        {strings.dashboard2.open}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </>
  );
}
