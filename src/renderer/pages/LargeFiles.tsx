import { useEffect, useMemo, useState } from 'react';
import type { FileKind } from '../../shared/types';
import { SelectionFooter } from '../components/SelectionFooter';
import { buttonStyles } from '../components/ui';
import { formatBytes, formatDate, splitPath } from '../format';
import { useScan } from '../scan/ScanContext';
import { summarizeSelection } from '../scan/selection';
import { strings } from '../strings';

type Filter = FileKind | 'all';
const FILTERS: Filter[] = ['all', 'video', 'disk-image', 'archive', 'other'];

export function LargeFilesPage({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { result, selected, setSelected } = useScan();
  const [filter, setFilter] = useState<Filter>('all');
  const [threshold, setThreshold] = useState<number | null>(null);

  useEffect(() => {
    void window.macsweep.settings
      .get()
      .then((settings) => setThreshold(settings.largeFileThresholdBytes))
      .catch(() => undefined);
  }, []);

  const category = result?.categories.find((c) => c.id === 'large-files');
  const items = useMemo(
    () => (category?.items ?? []).filter((item) => filter === 'all' || item.fileKind === filter),
    [category, filter],
  );
  const details = useMemo(
    () => summarizeSelection(category ? [category] : [], selected),
    [category, selected],
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-col gap-3 px-8 pb-4">
        <h1 className="text-2xl font-semibold">{strings.largeFiles.title}</h1>
        {threshold !== null && (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            {strings.largeFiles.intro(formatBytes(threshold))}{' '}
            <button
              type="button"
              onClick={onOpenSettings}
              className="text-blue-700 underline dark:text-blue-400"
            >
              {strings.largeFiles.changeThreshold}
            </button>
          </p>
        )}
        <div role="group" aria-label={strings.largeFiles.filterLabel} className="flex gap-2">
          {FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={
                filter === value
                  ? `${buttonStyles.primary} px-3 py-1`
                  : `${buttonStyles.secondary} px-3 py-1`
              }
            >
              {strings.largeFiles.filters[value]}
            </button>
          ))}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto border-y border-neutral-200 dark:border-neutral-800">
        {!result && <p className="px-8 py-6">{strings.largeFiles.noScan}</p>}
        {result && items.length === 0 && <p className="px-8 py-6">{strings.largeFiles.empty}</p>}
        <ul data-testid="large-files-list">
          {items.map((item) => {
            const { name, folder } = splitPath(item.path, result?.root ?? '');
            return (
              <li
                key={item.path}
                data-testid="large-file"
                data-path={item.path}
                className="flex items-center gap-3 border-b border-neutral-100 px-8 py-2 text-sm dark:border-neutral-900"
              >
                <input
                  type="checkbox"
                  aria-label={strings.review.selectItem(item.path)}
                  checked={selected.has(item.path)}
                  onChange={(event) => setSelected([item.path], event.target.checked)}
                  className="size-4 accent-blue-600"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium" title={item.path}>
                    {name}
                  </p>
                  <p className="truncate text-xs text-neutral-500" title={item.path}>
                    {folder}
                    {item.protected && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
                        {strings.largeFiles.protectedBadge}
                      </span>
                    )}
                  </p>
                </div>
                <span className="w-24 text-xs text-neutral-600 dark:text-neutral-400">
                  {strings.largeFiles.filters[item.fileKind ?? 'other']}
                </span>
                <span className="w-28 text-right text-xs text-neutral-600 dark:text-neutral-400">
                  {formatDate(item.modifiedMs)}
                </span>
                <span className="w-20 text-right tabular-nums">{formatBytes(item.sizeBytes)}</span>
                <button
                  type="button"
                  aria-label={`${strings.review.reveal} : ${item.path}`}
                  onClick={() => void window.macsweep.fs.reveal(item.path).catch(() => undefined)}
                  className={buttonStyles.ghost}
                >
                  {strings.review.revealShort}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <SelectionFooter details={details} />
    </div>
  );
}
