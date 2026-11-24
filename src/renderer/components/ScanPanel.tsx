import { useEffect, useRef, useState } from 'react';
import { CATEGORY_META, type RiskLevel } from '../../shared/categories';
import type { ScanDone, ScanProgress } from '../../shared/types';
import { formatBytes } from '../format';
import { strings } from '../strings';

type PanelState =
  | { status: 'idle'; error?: string }
  | { status: 'running'; progress?: ScanProgress }
  | { status: 'done'; result: ScanDone };

const RISK_STYLES: Record<RiskLevel, string> = {
  low: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  medium: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  high: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
};

const numberFormat = new Intl.NumberFormat('fr-FR');

export function ScanPanel() {
  const [state, setState] = useState<PanelState>({ status: 'idle' });
  const scanId = useRef<string | null>(null);
  const cancelRequested = useRef(false);

  useEffect(() => {
    // Events from a previous scan are ignored; before start() resolves the id is not known yet.
    const isCurrent = (id: string) => scanId.current === null || scanId.current === id;
    const offProgress = window.macsweep.scan.onProgress((progress) => {
      if (isCurrent(progress.scanId)) setState({ status: 'running', progress });
    });
    const offDone = window.macsweep.scan.onDone((result) => {
      if (isCurrent(result.scanId)) setState({ status: 'done', result });
    });
    return () => {
      offProgress();
      offDone();
    };
  }, []);

  async function start() {
    scanId.current = null;
    cancelRequested.current = false;
    setState({ status: 'running' });
    try {
      const id = await window.macsweep.scan.start();
      scanId.current = id;
      // Cancel clicked before the scan id came back: honour it now.
      if (cancelRequested.current) void window.macsweep.scan.cancel(id);
    } catch {
      setState({ status: 'idle', error: strings.scan.startError });
    }
  }

  function cancel() {
    cancelRequested.current = true;
    if (scanId.current) void window.macsweep.scan.cancel(scanId.current);
  }

  return (
    <div className="max-w-xl rounded-xl border border-neutral-200 p-5 dark:border-neutral-800">
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 className="text-sm font-medium text-neutral-600 dark:text-neutral-400">
          {strings.scan.title}
        </h2>
        {state.status === 'running' ? (
          <button type="button" onClick={cancel} className={buttonClass('secondary')}>
            {strings.scan.cancel}
          </button>
        ) : (
          <button type="button" onClick={() => void start()} className={buttonClass('primary')}>
            {strings.scan.start}
          </button>
        )}
      </div>
      <p className="mb-3 text-xs text-neutral-500">{strings.scan.preview}</p>

      {state.status === 'idle' && state.error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {state.error}
        </p>
      )}
      {state.status === 'running' && <Progress progress={state.progress} />}
      {state.status === 'done' && <Results result={state.result} />}
    </div>
  );
}

function Progress({ progress }: { progress: ScanProgress | undefined }) {
  return (
    <div role="status" aria-live="polite" className="text-sm">
      {progress ? (
        <>
          <p className="font-medium">
            {strings.scan.running(strings.categories[progress.categoryId])}
          </p>
          <p className="tabular-nums text-neutral-600 dark:text-neutral-400">
            {strings.scan.filesVisited(numberFormat.format(progress.filesVisited))} ·{' '}
            {formatBytes(progress.bytesFound)}
          </p>
          <p className="truncate text-xs text-neutral-500" title={progress.currentDir}>
            {progress.currentDir}
          </p>
        </>
      ) : (
        <p>…</p>
      )}
    </div>
  );
}

function Results({ result }: { result: ScanDone }) {
  const seconds = (result.durationMs / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
  return (
    <div data-testid="scan-results" className="text-sm">
      <p role="status" className="mb-3 font-medium">
        {strings.scan.status[result.status]} {strings.scan.duration(seconds)}
      </p>
      {result.error && <p className="mb-3 text-red-700 dark:text-red-400">{result.error}</p>}
      {result.deniedCount > 0 && (
        <p className="mb-3 rounded-md bg-amber-50 p-2 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
          {strings.scan.denied(result.deniedCount)}
        </p>
      )}
      {result.categories.length === 0 ? (
        <p>{strings.scan.empty}</p>
      ) : (
        <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
          {result.categories.map((category) => {
            const risk = CATEGORY_META[category.id].risk;
            return (
              <li
                key={category.id}
                data-category={category.id}
                className="flex items-center gap-3 py-2"
              >
                <span className="flex-1">{strings.categories[category.id]}</span>
                <span className={`rounded px-1.5 py-0.5 text-xs ${RISK_STYLES[risk]}`}>
                  {strings.risk[risk]}
                </span>
                <span className="w-24 text-right text-neutral-600 dark:text-neutral-400">
                  {strings.scan.items(category.items.length)}
                </span>
                <span className="w-20 text-right font-medium tabular-nums">
                  {formatBytes(category.totalBytes)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function buttonClass(kind: 'primary' | 'secondary'): string {
  const base =
    'rounded-md px-3 py-1.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-900';
  return kind === 'primary'
    ? `${base} bg-blue-600 text-white hover:bg-blue-700`
    : `${base} border border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800`;
}
