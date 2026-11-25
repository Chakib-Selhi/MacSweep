import { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, Treemap, type TreemapNode } from 'recharts';
import type { ExploreDone, ExploreEntry, ExploreListing, ExploreScope } from '../../shared/types';
import { SelectionFooter } from '../components/SelectionFooter';
import { buttonStyles } from '../components/ui';
import { useExplore } from '../explore/ExploreContext';
import { crumbs, exploreSelection, parentOf } from '../explore/model';
import { formatBytes, formatDuration, percentOf } from '../format';
import { strings } from '../strings';

const numberFormat = new Intl.NumberFormat('fr-FR');
const SCOPES: ExploreScope[] = ['home', 'disk'];
const MAP_TILES = 60;
const DIR_COLORS = ['#2563eb', '#3b82f6', '#1d4ed8', '#60a5fa', '#1e40af', '#93c5fd'];
const FILE_COLOR = '#0d9488';
const OTHERS_COLOR = '#a3a3a3';

export function ExplorePage() {
  const { running, progress, done, error, start, cancel } = useExplore();
  const [scope, setScope] = useState<ExploreScope>(done?.scope ?? 'home');

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-col gap-3 px-8 pb-4">
        <h1 className="text-2xl font-semibold">{strings.explore.title}</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">{strings.explore.intro}</p>
        <div className="flex flex-wrap items-center gap-4">
          <fieldset className="flex gap-3" disabled={running}>
            <legend className="sr-only">{strings.explore.scopeLabel}</legend>
            {SCOPES.map((value) => (
              <label key={value} className="flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  name="explore-scope"
                  checked={scope === value}
                  onChange={() => setScope(value)}
                  className="accent-blue-600"
                />
                {strings.explore.scopes[value]}
              </label>
            ))}
          </fieldset>
          {running ? (
            <button type="button" onClick={cancel} className={buttonStyles.secondary}>
              {strings.explore.cancel}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void start(scope)}
              className={buttonStyles.primary}
            >
              {done ? strings.explore.restart : strings.explore.start}
            </button>
          )}
        </div>
        <div role="status" aria-live="polite" data-testid="explore-status" className="text-sm">
          {running && (
            <p className="truncate tabular-nums text-neutral-600 dark:text-neutral-400">
              {strings.explore.running(
                numberFormat.format(progress?.filesVisited ?? 0),
                formatBytes(progress?.bytesFound ?? 0),
              )}{' '}
              <span className="text-neutral-500">{progress?.currentDir}</span>
            </p>
          )}
          {error && <p className="text-red-700 dark:text-red-400">{error}</p>}
          {!running && done && <Summary done={done} />}
        </div>
      </header>
      {!running && done?.status === 'completed' && <MapBrowser key={done.exploreId} done={done} />}
    </div>
  );
}

function Summary({ done }: { done: ExploreDone }) {
  const [usedBytes, setUsedBytes] = useState<number | null>(null);
  useEffect(() => {
    if (done.scope !== 'disk') return;
    void window.macsweep.disk
      .info()
      .then((info) => setUsedBytes(info.usedBytes))
      .catch(() => undefined);
  }, [done]);
  const hidden = usedBytes === null ? 0 : usedBytes - done.sizeBytes;

  return (
    <div className="flex flex-col gap-1">
      <p className="font-medium">
        {strings.explore.status[done.status]}
        {done.status === 'completed' &&
          ` : ${strings.explore.summary(
            formatBytes(done.sizeBytes),
            numberFormat.format(done.fileCount),
            formatDuration(done.durationMs),
          )}`}
      </p>
      {done.deniedCount > 0 && (
        <p className="text-neutral-600 dark:text-neutral-400">
          {strings.explore.denied(done.deniedCount)}
        </p>
      )}
      {done.status === 'completed' && hidden > 1_000_000_000 && (
        <p className="text-neutral-600 dark:text-neutral-400">
          {strings.explore.hidden(formatBytes(hidden))}
        </p>
      )}
    </div>
  );
}

function MapBrowser({ done }: { done: ExploreDone }) {
  const [current, setCurrent] = useState(done.rootPath);
  const [listing, setListing] = useState<ExploreListing | null | undefined>(undefined);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    void window.macsweep.explore
      .list(current)
      .then((next) => live && setListing(next))
      .catch(() => live && setListing(null));
    return () => {
      live = false;
    };
  }, [current, version]);

  const open = (target: string) => {
    setSelected(new Set());
    setCurrent(target);
  };
  const entries = useMemo(() => listing?.entries ?? [], [listing]);
  const details = useMemo(
    () => exploreSelection(entries.filter((entry) => selected.has(entry.path))),
    [entries, selected],
  );
  const toggle = (entry: ExploreEntry, checked: boolean) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (checked) next.add(entry.path);
      else next.delete(entry.path);
      return next;
    });
  };
  const parent = parentOf(done.rootPath, current);

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-6">
        <nav
          aria-label={strings.explore.breadcrumb}
          className="mb-3 flex flex-wrap items-center gap-1 text-sm"
        >
          {parent !== null && (
            <button type="button" onClick={() => open(parent)} className={buttonStyles.ghost}>
              ↑ {strings.explore.up}
            </button>
          )}
          {crumbs(done.rootPath, done.homePath, current).map((crumb, index, all) => (
            <span key={crumb.path} className="flex items-center gap-1">
              {index > 0 && <span className="text-neutral-400">/</span>}
              {index === all.length - 1 ? (
                <span className="font-medium" aria-current="location">
                  {crumb.label}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => open(crumb.path)}
                  className="text-blue-700 hover:underline dark:text-blue-400"
                >
                  {crumb.label}
                </button>
              )}
            </span>
          ))}
        </nav>

        {listing === null && <p className="text-sm">{strings.explore.gone}</p>}
        {listing && (
          <>
            <p className="mb-3 text-sm tabular-nums text-neutral-600 dark:text-neutral-400">
              {formatBytes(listing.sizeBytes)} ·{' '}
              {strings.explore.files(numberFormat.format(listing.fileCount))}
            </p>
            {entries.length === 0 ? (
              <p className="text-sm">{strings.explore.empty}</p>
            ) : (
              <>
                <FolderMap entries={entries} onOpen={open} />
                <ul
                  className="mt-4 rounded-xl border border-neutral-200 dark:border-neutral-800"
                  data-testid="explore-list"
                >
                  {entries.map((entry) => (
                    <EntryRow
                      key={`${entry.kind}:${entry.name}`}
                      entry={entry}
                      share={percentOf(entry.sizeBytes, listing.sizeBytes)}
                      checked={selected.has(entry.path)}
                      onToggle={toggle}
                      onOpen={open}
                    />
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
      <SelectionFooter
        details={details}
        execute={(paths, request) => window.macsweep.explore.trash(paths, request)}
        onReport={(report) => {
          if (report.dryRun) return;
          setSelected(new Set());
          setVersion((v) => v + 1);
        }}
      />
    </>
  );
}

function EntryRow({
  entry,
  share,
  checked,
  onToggle,
  onOpen,
}: {
  entry: ExploreEntry;
  share: number;
  checked: boolean;
  onToggle: (entry: ExploreEntry, checked: boolean) => void;
  onOpen: (path: string) => void;
}) {
  const label =
    entry.kind === 'others'
      ? strings.explore.others(numberFormat.format(entry.fileCount))
      : entry.name;
  const selectable = entry.trashable && entry.kind !== 'others';

  return (
    <li
      data-testid="explore-entry"
      data-kind={entry.kind}
      className="flex items-center gap-3 border-b border-neutral-200 px-4 py-2 text-sm last:border-b-0 dark:border-neutral-800"
    >
      <input
        type="checkbox"
        aria-label={strings.explore.select(label)}
        checked={checked}
        disabled={!selectable}
        onChange={(event) => onToggle(entry, event.target.checked)}
        className="size-4 shrink-0 accent-blue-600 disabled:opacity-30"
      />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {entry.kind === 'directory' ? (
          <button
            type="button"
            aria-label={strings.explore.open(entry.name)}
            onClick={() => onOpen(entry.path)}
            className="truncate font-medium text-blue-700 hover:underline dark:text-blue-400"
          >
            📁 {entry.name}
          </button>
        ) : (
          <span className={`truncate ${entry.kind === 'others' ? 'text-neutral-500' : ''}`}>
            {label}
          </span>
        )}
        {entry.denied && (
          <span className="shrink-0 rounded bg-amber-100 px-1.5 text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
            {strings.explore.denied1}
          </span>
        )}
        {!entry.trashable && entry.kind !== 'others' && !entry.denied && (
          <span
            title={strings.explore.readOnlyHint}
            className="shrink-0 rounded bg-neutral-200 px-1.5 text-xs text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
          >
            {strings.explore.readOnly}
          </span>
        )}
        {entry.protected && (
          <span className="shrink-0 rounded bg-blue-100 px-1.5 text-xs text-blue-900 dark:bg-blue-950 dark:text-blue-200">
            {strings.explore.protectedBadge}
          </span>
        )}
      </div>
      <div className="hidden w-28 shrink-0 sm:block" aria-hidden="true">
        <div className="h-1.5 rounded bg-neutral-200 dark:bg-neutral-800">
          <div className="h-1.5 rounded bg-blue-500" style={{ width: `${share}%` }} />
        </div>
      </div>
      <span className="w-20 shrink-0 text-right tabular-nums">{formatBytes(entry.sizeBytes)}</span>
      {entry.kind !== 'others' && (
        <button
          type="button"
          onClick={() => void window.macsweep.fs.reveal(entry.path).catch(() => undefined)}
          className={buttonStyles.ghost}
        >
          {strings.review.revealShort}
        </button>
      )}
    </li>
  );
}

/** Decorative: the list below gives the same figures as text and is keyboard-friendly. */
function FolderMap({
  entries,
  onOpen,
}: {
  entries: readonly ExploreEntry[];
  onOpen: (path: string) => void;
}) {
  const data = entries
    .filter((entry) => entry.sizeBytes > 0)
    .slice(0, MAP_TILES)
    .map((entry, index) => ({
      name:
        entry.kind === 'others'
          ? strings.explore.others(numberFormat.format(entry.fileCount))
          : entry.name,
      value: entry.sizeBytes,
      path: entry.path,
      kind: entry.kind,
      fill:
        entry.kind === 'others'
          ? OTHERS_COLOR
          : entry.kind === 'file'
            ? FILE_COLOR
            : (DIR_COLORS[index % DIR_COLORS.length] as string),
    }));
  if (data.length === 0) return null;

  return (
    <div
      aria-hidden="true"
      data-testid="explore-map"
      title={strings.explore.mapLabel}
      className="h-64"
    >
      <ResponsiveContainer width="100%" height="100%">
        <Treemap
          data={data}
          dataKey="value"
          isAnimationActive={false}
          onClick={(node: TreemapNode) => {
            if (node.kind === 'directory' && typeof node.path === 'string') onOpen(node.path);
          }}
          content={(node: TreemapNode) => <Tile {...node} />}
        />
      </ResponsiveContainer>
    </div>
  );
}

function Tile(node: TreemapNode) {
  if (node.depth === 0) return <g />;
  const { x, y, width, height, name } = node;
  const fill = typeof node.fill === 'string' ? node.fill : OTHERS_COLOR;
  const showLabel = width > 70 && height > 28;
  return (
    <g className={node.kind === 'directory' ? 'cursor-pointer' : undefined}>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={fill}
        stroke="#fff"
        strokeWidth={2}
        rx={3}
      />
      {showLabel && (
        <>
          <text x={x + 8} y={y + 18} fill="#fff" fontSize={12} fontWeight={600}>
            {name.length > width / 8
              ? `${name.slice(0, Math.max(1, Math.floor(width / 8) - 1))}…`
              : name}
          </text>
          {height > 44 && (
            <text x={x + 8} y={y + 34} fill="#fff" fontSize={11} opacity={0.85}>
              {formatBytes(node.value)}
            </text>
          )}
        </>
      )}
    </g>
  );
}
