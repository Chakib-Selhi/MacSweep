import { useVirtualizer } from '@tanstack/react-virtual';
import { useDeferredValue, useMemo, useRef, useState } from 'react';
import { CATEGORY_META, type CategoryId } from '../../shared/categories';
import type { CategoryResult, ScanItem } from '../../shared/types';
import { CleanDialog, type CategoryShare } from '../components/CleanDialog';
import { EmptyTrashDialog } from '../components/EmptyTrashDialog';
import { RiskBadge } from '../components/RiskBadge';
import { buttonStyles } from '../components/ui';
import { formatBytes, formatDate, splitPath } from '../format';
import { useScan } from '../scan/ScanContext';
import {
  buildRows,
  categorySelection,
  isSelectable,
  selectionSummary,
  visibleItems,
  type CategorySelection,
  type Row,
  type SortKey,
} from '../scan/selection';
import { strings } from '../strings';

const CATEGORY_ROW_HEIGHT = 60;
const ITEM_ROW_HEIGHT = 52;
const ITEM_WITH_WARNING_HEIGHT = 70;
const numberFormat = new Intl.NumberFormat('fr-FR');

export function Review({ onBack }: { onBack: () => void }) {
  const { result, selected, setSelected, dryRun, setDryRun } = useScan();
  const root = result?.root ?? '';
  const [cleanOpen, setCleanOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [sort, setSort] = useState<SortKey>('size');
  const [expanded, setExpanded] = useState<ReadonlySet<CategoryId>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);

  const categories = useMemo(() => result?.categories ?? [], [result]);
  const rows = useMemo(
    () => buildRows(categories, expanded, deferredQuery, sort),
    [categories, expanded, deferredQuery, sort],
  );
  const summary = useMemo(
    () => (result ? selectionSummary(result, selected) : { count: 0, bytes: 0 }),
    [result, selected],
  );
  const selections = useMemo(
    () => new Map(categories.map((c) => [c.id, categorySelection(c, selected)])),
    [categories, selected],
  );
  const { paths, shares } = useMemo(() => {
    const paths: string[] = [];
    const shares: CategoryShare[] = [];
    for (const category of categories) {
      let count = 0;
      let bytes = 0;
      for (const item of category.items) {
        if (!selected.has(item.path)) continue;
        paths.push(item.path);
        count += 1;
        bytes += item.sizeBytes;
      }
      if (count > 0) shares.push({ id: category.id, count, bytes });
    }
    return { paths, shares };
  }, [categories, selected]);

  // Rows are absolutely positioned and only the visible ones are in the DOM. The app does not use
  // the React Compiler, so its warning about this hook not being memoizable does not apply.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => listRef.current,
    estimateSize: (index) => {
      const row = rows[index];
      if (row?.kind === 'category') return CATEGORY_ROW_HEIGHT;
      return row?.item.openApp ? ITEM_WITH_WARNING_HEIGHT : ITEM_ROW_HEIGHT;
    },
    getItemKey: (index) => {
      const row = rows[index];
      if (!row) return index;
      return row.kind === 'category' ? `c:${row.category.id}` : `i:${row.item.path}`;
    },
    overscan: 12,
  });

  if (!result) {
    return (
      <div className="px-8">
        <p>{strings.review.noResult}</p>
      </div>
    );
  }

  const searching = deferredQuery.trim() !== '';

  function selectMatching(checked: boolean) {
    const paths = categories.flatMap((category) =>
      visibleItems(category, deferredQuery, sort)
        .filter((item) => isSelectable(category.id, item))
        .map((item) => item.path),
    );
    setSelected(paths, checked);
  }

  function toggleExpanded(id: CategoryId) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-col gap-4 px-8 pb-4">
        <div className="flex items-center gap-4">
          <button type="button" onClick={onBack} className={buttonStyles.secondary}>
            ← {strings.review.back}
          </button>
          <h1 className="text-2xl font-semibold">{strings.review.title}</h1>
        </div>
        {dryRun && (
          <p
            data-testid="dry-run-banner"
            className="rounded-md bg-blue-50 p-3 text-sm text-blue-900 dark:bg-blue-950 dark:text-blue-200"
          >
            {strings.dryRun.banner}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={strings.review.search}
            aria-label={strings.review.search}
            className="min-w-40 flex-1 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-900"
          />
          <label className="flex items-center gap-2 text-sm">
            {strings.review.sortLabel}
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as SortKey)}
              className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            >
              <option value="size">{strings.review.sortSize}</option>
              <option value="date">{strings.review.sortDate}</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => selectMatching(true)}
            className={buttonStyles.secondary}
          >
            {strings.review.selectAll}
          </button>
          <button
            type="button"
            onClick={() => selectMatching(false)}
            className={buttonStyles.secondary}
          >
            {strings.review.selectNone}
          </button>
        </div>
      </header>

      <div
        ref={listRef}
        data-testid="review-list"
        className="min-h-0 flex-1 overflow-y-auto border-y border-neutral-200 dark:border-neutral-800"
      >
        {rows.length === 0 ? (
          <p className="px-8 py-6 text-neutral-600 dark:text-neutral-400">
            {strings.review.noMatch}
          </p>
        ) : (
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index] as Row;
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  className="absolute left-0 top-0 w-full"
                  style={{
                    height: virtualRow.size,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  {row.kind === 'category' ? (
                    <CategoryRow
                      category={row.category}
                      matches={row.matches}
                      selection={selections.get(row.category.id)}
                      expanded={searching || expanded.has(row.category.id)}
                      canToggle={!searching}
                      onToggleExpanded={() => toggleExpanded(row.category.id)}
                      onEmptyTrash={() => setTrashOpen(true)}
                      onSelect={(checked) =>
                        setSelected(
                          row.category.items
                            .filter((item) => isSelectable(row.category.id, item))
                            .map((item) => item.path),
                          checked,
                        )
                      }
                    />
                  ) : (
                    <ItemRow
                      root={root}
                      categoryId={row.categoryId}
                      item={row.item}
                      checked={selected.has(row.item.path)}
                      onChange={(checked) => setSelected([row.item.path], checked)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <footer
        data-testid="selection-bar"
        className="flex items-center justify-between gap-4 bg-neutral-50 px-8 py-3 dark:bg-neutral-950"
      >
        <p role="status" aria-live="polite" className="font-medium tabular-nums">
          {strings.review.selectedTotal(
            numberFormat.format(summary.count),
            formatBytes(summary.bytes),
          )}
        </p>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(event) => void setDryRun(event.target.checked)}
              className="size-4 accent-blue-600"
            />
            <span>
              {strings.dryRun.toggle}
              <span className="ml-1 text-xs text-neutral-500">({strings.dryRun.hint})</span>
            </span>
          </label>
          <button
            type="button"
            disabled={paths.length === 0}
            onClick={() => setCleanOpen(true)}
            className={buttonStyles.primary}
          >
            {strings.review.clean}
          </button>
        </div>
      </footer>

      {cleanOpen && (
        <CleanDialog
          paths={paths}
          totalBytes={summary.bytes}
          shares={shares}
          onClose={() => setCleanOpen(false)}
        />
      )}
      {trashOpen && <EmptyTrashDialog onClose={() => setTrashOpen(false)} />}
    </div>
  );
}

interface CategoryRowProps {
  category: CategoryResult;
  matches: number;
  selection: CategorySelection | undefined;
  expanded: boolean;
  canToggle: boolean;
  onToggleExpanded: () => void;
  onEmptyTrash: () => void;
  onSelect: (checked: boolean) => void;
}

function CategoryRow(props: CategoryRowProps) {
  const { category, matches, selection, expanded, canToggle, onToggleExpanded, onSelect } = props;
  const { onEmptyTrash } = props;
  const label = strings.categories[category.id];
  const meta = CATEGORY_META[category.id];
  const openApps = category.items.filter((item) => item.openApp !== undefined).length;
  const selectable = category.items.some((item) => isSelectable(category.id, item));
  const state = selection?.state ?? 'none';

  return (
    <div
      data-testid="review-category"
      data-category={category.id}
      className="flex h-full items-center gap-3 bg-neutral-50 px-8 dark:bg-neutral-950"
    >
      <input
        type="checkbox"
        aria-label={strings.review.selectCategory(label)}
        checked={state === 'all'}
        ref={(input) => {
          if (input) input.indeterminate = state === 'some';
        }}
        disabled={!selectable}
        onChange={() => onSelect(state !== 'all')}
        className="size-4 accent-blue-600"
      />
      <button
        type="button"
        onClick={onToggleExpanded}
        disabled={!canToggle}
        aria-expanded={expanded}
        aria-label={expanded ? strings.review.collapse(label) : strings.review.expand(label)}
        className="w-5 rounded text-neutral-500 outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        {expanded ? '▾' : '▸'}
      </button>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 font-medium">
          <span className="truncate">{label}</span>
          <RiskBadge risk={meta.risk} />
        </p>
        <p className="truncate text-xs text-neutral-600 dark:text-neutral-400">
          {strings.scan.items(matches)}
          {openApps > 0 && ` · ${strings.review.openAppCount(openApps)}`}
          {meta.permanent && ` · ${strings.review.trashNote}`}
        </p>
      </div>
      {meta.permanent ? (
        <>
          <p className="text-sm tabular-nums text-neutral-600 dark:text-neutral-400">
            {formatBytes(category.totalBytes)}
          </p>
          <button
            type="button"
            onClick={onEmptyTrash}
            className={`${buttonStyles.secondary} text-red-700 dark:text-red-400`}
          >
            {strings.review.emptyTrash}
          </button>
        </>
      ) : (
        <p className="w-40 text-right text-sm tabular-nums text-neutral-600 dark:text-neutral-400">
          {formatBytes(selection?.bytes ?? 0)} / {formatBytes(category.totalBytes)}
        </p>
      )}
    </div>
  );
}

interface ItemRowProps {
  root: string;
  categoryId: CategoryId;
  item: ScanItem;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function ItemRow({ root, categoryId, item, checked, onChange }: ItemRowProps) {
  const selectable = isSelectable(categoryId, item);
  const { name, folder } = splitPath(item.path, root);
  return (
    <div
      data-testid="review-item"
      data-path={item.path}
      className="flex h-full items-center gap-3 border-t border-neutral-100 pl-16 pr-8 text-sm dark:border-neutral-900"
    >
      <input
        type="checkbox"
        aria-label={strings.review.selectItem(item.path)}
        checked={checked}
        disabled={!selectable}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 accent-blue-600"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium" title={item.path}>
          {name}
        </p>
        <p className="truncate text-xs text-neutral-500" title={item.path}>
          {folder}
        </p>
        {item.openApp && (
          <p className="text-xs font-medium text-orange-700 dark:text-orange-400">
            {strings.review.openApp(item.openApp)}
          </p>
        )}
      </div>
      <span className="w-28 text-right text-xs text-neutral-600 dark:text-neutral-400">
        {formatDate(item.modifiedMs)}
      </span>
      <span className="w-20 text-right tabular-nums">{formatBytes(item.sizeBytes)}</span>
      <button
        type="button"
        aria-label={`${strings.review.reveal} : ${item.path}`}
        title={strings.review.reveal}
        onClick={() => void window.macsweep.fs.reveal(item.path).catch(() => undefined)}
        className={buttonStyles.ghost}
      >
        {strings.review.revealShort}
      </button>
    </div>
  );
}
