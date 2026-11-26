import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppInfo, CleanReport } from '../../shared/types';
import { Dialog } from '../components/Dialog';
import { buttonStyles } from '../components/ui';
import { formatBytes } from '../format';
import { useScan } from '../scan/ScanContext';
import { strings } from '../strings';

const numberFormat = new Intl.NumberFormat('fr-FR');

type Load = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; apps: AppInfo[] };

/** `~/Library/Caches/x` → { name: 'x', folder: '~/Library/Caches' }. */
function describeLeftover(fullPath: string): { name: string; folder: string } {
  const cut = fullPath.lastIndexOf('/');
  const folder = fullPath.slice(0, cut);
  const library = folder.indexOf('/Library');
  return {
    name: fullPath.slice(cut + 1),
    folder: library >= 0 ? `~${folder.slice(library)}` : folder,
  };
}

export function AppsPage() {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [query, setQuery] = useState('');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    void window.macsweep.apps
      .list()
      .then((apps) => live && setLoad({ kind: 'ready', apps }))
      .catch(() => live && setLoad({ kind: 'error' }));
    return () => {
      live = false;
    };
  }, [version]);

  const refresh = useCallback(() => {
    setLoad({ kind: 'loading' });
    setVersion((v) => v + 1);
  }, []);

  const apps = useMemo(() => (load.kind === 'ready' ? load.apps : []), [load]);
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('fr');
    return needle ? apps.filter((app) => app.name.toLocaleLowerCase('fr').includes(needle)) : apps;
  }, [apps, query]);
  const selected = apps.find((app) => app.path === selectedPath) ?? null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-col gap-3 px-8 pb-4">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold">{strings.apps.title}</h1>
          <button type="button" onClick={refresh} className={buttonStyles.secondary}>
            {strings.apps.refresh}
          </button>
        </div>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">{strings.apps.intro}</p>
      </header>
      {load.kind === 'loading' && (
        <p role="status" className="px-8 text-sm">
          {strings.apps.loading}
        </p>
      )}
      {load.kind === 'error' && (
        <p role="alert" className="px-8 text-sm text-red-700 dark:text-red-400">
          {strings.apps.error}
        </p>
      )}
      {load.kind === 'ready' && (
        <div className="flex min-h-0 flex-1 gap-4 px-8 pb-6">
          <div className="flex w-72 shrink-0 flex-col gap-2">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={strings.apps.search}
              aria-label={strings.apps.search}
              className="rounded-md border border-neutral-300 bg-transparent px-3 py-1.5 text-sm dark:border-neutral-700"
            />
            <ul
              data-testid="app-list"
              className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-neutral-200 dark:border-neutral-800"
            >
              {visible.length === 0 && <li className="p-4 text-sm">{strings.apps.empty}</li>}
              {visible.map((app) => (
                <li key={app.path}>
                  <button
                    type="button"
                    data-testid="app-row"
                    aria-pressed={app.path === selectedPath}
                    onClick={() => setSelectedPath(app.path)}
                    className={`flex w-full items-center justify-between gap-2 border-b border-neutral-200 px-3 py-2 text-left text-sm dark:border-neutral-800 ${
                      app.path === selectedPath
                        ? 'bg-blue-50 dark:bg-blue-950'
                        : 'hover:bg-neutral-100 dark:hover:bg-neutral-900'
                    }`}
                  >
                    <span className={`truncate ${app.refusal ? 'text-neutral-500' : ''}`}>
                      {app.name}
                    </span>
                    <span className="shrink-0 tabular-nums text-neutral-600 dark:text-neutral-400">
                      {formatBytes(app.sizeBytes)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <section className="min-w-0 flex-1 overflow-y-auto">
            {selected ? (
              <AppDetail key={selected.path} app={selected} onDone={refresh} />
            ) : (
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                {strings.apps.choose}
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function AppDetail({ app, onDone }: { app: AppInfo; onDone: () => void }) {
  const { dryRun, setDryRun } = useScan();
  const [checked, setChecked] = useState<ReadonlySet<string>>(
    () => new Set(app.leftovers.filter((item) => item.defaultChecked).map((item) => item.path)),
  );
  const [open, setOpen] = useState(false);
  const leftoversBytes = app.leftovers.reduce((sum, item) => sum + item.sizeBytes, 0);
  const chosen = app.leftovers.filter((item) => checked.has(item.path));
  const chosenBytes = app.sizeBytes + chosen.reduce((sum, item) => sum + item.sizeBytes, 0);

  return (
    <div data-testid="app-detail" className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold">{app.name}</h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {strings.apps.locations[app.location]} · {app.bundleId ?? '—'}
        </p>
        <p className="mt-1 text-sm tabular-nums">
          {formatBytes(app.sizeBytes)} ·{' '}
          {strings.apps.total(formatBytes(app.sizeBytes + leftoversBytes))}
        </p>
      </div>

      {app.refusal && (
        <p
          data-testid="app-refusal"
          className="rounded-md bg-neutral-100 p-3 text-sm dark:bg-neutral-900"
        >
          {strings.apps.refused(strings.clean.reasons[app.refusal])}
        </p>
      )}

      <div>
        <h3 className="mb-1 font-medium">{strings.apps.leftoversTitle}</h3>
        {app.leftovers.length === 0 ? (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            {strings.apps.noLeftovers}
          </p>
        ) : (
          <>
            <p className="mb-2 text-xs text-neutral-500">{strings.apps.leftoverHint}</p>
            <ul className="rounded-xl border border-neutral-200 dark:border-neutral-800">
              {app.leftovers.map((item) => {
                const { name, folder } = describeLeftover(item.path);
                return (
                  <li
                    key={item.path}
                    data-testid="leftover"
                    className="flex items-center gap-3 border-b border-neutral-200 px-3 py-2 text-sm last:border-b-0 dark:border-neutral-800"
                  >
                    <input
                      type="checkbox"
                      aria-label={strings.apps.selectLeftover(name)}
                      checked={checked.has(item.path)}
                      disabled={Boolean(app.refusal)}
                      onChange={(event) => {
                        const include = event.target.checked;
                        setChecked((previous) => {
                          const next = new Set(previous);
                          if (include) next.add(item.path);
                          else next.delete(item.path);
                          return next;
                        });
                      }}
                      className="size-4 shrink-0 accent-blue-600"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate" title={item.path}>
                        {name}
                      </p>
                      <p className="truncate text-xs text-neutral-500">
                        {strings.apps.kinds[item.kind]} · {folder}
                      </p>
                    </div>
                    <span className="shrink-0 tabular-nums">{formatBytes(item.sizeBytes)}</span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-4">
        <p className="text-sm tabular-nums">{strings.apps.selected(formatBytes(chosenBytes))}</p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(event) => void setDryRun(event.target.checked)}
            className="size-4 accent-blue-600"
          />
          {strings.dryRun.toggle}
        </label>
        <button
          type="button"
          disabled={Boolean(app.refusal)}
          onClick={() => setOpen(true)}
          className={buttonStyles.primary}
        >
          {strings.apps.uninstall}
        </button>
      </div>
      {open && (
        <UninstallDialog
          app={app}
          leftovers={chosen.map((item) => item.path)}
          totalBytes={chosenBytes}
          onClose={(report) => {
            setOpen(false);
            if (report && !report.dryRun && report.moved.length > 0) onDone();
          }}
        />
      )}
    </div>
  );
}

type Step =
  | { kind: 'confirm' }
  | { kind: 'running' }
  | { kind: 'done'; report: CleanReport }
  | { kind: 'error' };

/** Mounted only while open: the typed name starts empty every time. */
function UninstallDialog({
  app,
  leftovers,
  totalBytes,
  onClose,
}: {
  app: AppInfo;
  leftovers: string[];
  totalBytes: number;
  onClose: (report?: CleanReport) => void;
}) {
  const { dryRun } = useScan();
  const [typed, setTyped] = useState('');
  const [step, setStep] = useState<Step>({ kind: 'confirm' });
  const close = () => onClose(step.kind === 'done' ? step.report : undefined);

  async function run() {
    setStep({ kind: 'running' });
    try {
      const report = await window.macsweep.apps.uninstall(app.path, {
        confirmName: typed,
        leftovers,
        dryRun,
      });
      setStep({ kind: 'done', report });
    } catch {
      setStep({ kind: 'error' });
    }
  }

  return (
    <Dialog
      open
      testId="uninstall-dialog"
      title={(dryRun ? strings.apps.dialogTitleDry : strings.apps.dialogTitle)(app.name)}
      canCancel={step.kind !== 'running'}
      onCancel={close}
    >
      {step.kind === 'confirm' && (
        <>
          <p className="text-lg font-medium tabular-nums">
            {strings.apps.dialogSummary(
              numberFormat.format(leftovers.length),
              formatBytes(totalBytes),
            )}
          </p>
          <p
            className={`my-4 rounded-md p-3 text-sm ${
              dryRun
                ? 'bg-blue-50 text-blue-900 dark:bg-blue-950 dark:text-blue-200'
                : 'bg-amber-50 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200'
            }`}
          >
            {dryRun ? strings.clean.destinationDry : strings.clean.destinationReal}
          </p>
          <label className="mb-4 flex flex-col gap-1 text-sm">
            <span>{strings.apps.typeName(app.name)}</span>
            <input
              type="text"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="rounded-md border border-neutral-300 bg-transparent px-3 py-1.5 dark:border-neutral-700"
            />
          </label>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={close} className={buttonStyles.secondary}>
              {strings.clean.cancel}
            </button>
            <button
              type="button"
              disabled={typed !== app.name}
              onClick={() => void run()}
              className={buttonStyles.primary}
            >
              {dryRun ? strings.apps.confirmDry : strings.apps.confirm}
            </button>
          </div>
        </>
      )}
      {step.kind === 'running' && <p role="status">{strings.apps.running}</p>}
      {step.kind === 'done' && (
        <>
          <p role="status" className="mb-3 font-medium" data-testid="clean-report">
            {(step.report.dryRun ? strings.clean.reportDry : strings.clean.reportReal)(
              formatBytes(step.report.bytesFreed),
              numberFormat.format(step.report.moved.length),
            )}
          </p>
          {step.report.failed.length > 0 && (
            <ul className="mb-4 max-h-48 overflow-y-auto text-sm" data-testid="clean-failures">
              {step.report.failed.map((failure) => (
                <li key={failure.path} className="flex justify-between gap-4 py-0.5">
                  <span className="truncate" title={failure.path}>
                    {failure.path.slice(failure.path.lastIndexOf('/') + 1)}
                  </span>
                  <span className="shrink-0 text-neutral-600 dark:text-neutral-400">
                    {strings.clean.reasons[failure.reason]}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end">
            <button type="button" onClick={close} className={buttonStyles.primary}>
              {strings.clean.close}
            </button>
          </div>
        </>
      )}
      {step.kind === 'error' && (
        <>
          <p role="alert" className="mb-4 text-red-700 dark:text-red-400">
            {strings.clean.error}
          </p>
          <div className="flex justify-end">
            <button type="button" onClick={close} className={buttonStyles.secondary}>
              {strings.clean.close}
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
