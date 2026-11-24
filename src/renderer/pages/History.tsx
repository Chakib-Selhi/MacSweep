import { useEffect, useState } from 'react';
import type { HistoryEntry } from '../../shared/types';
import { formatBytes } from '../format';
import { strings } from '../strings';

type HistoryState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; entries: HistoryEntry[] };

const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
const numberFormat = new Intl.NumberFormat('fr-FR');

export function HistoryPage() {
  const [state, setState] = useState<HistoryState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    window.macsweep.history
      .list()
      .then((entries) => !cancelled && setState({ status: 'ready', entries }))
      .catch(() => !cancelled && setState({ status: 'error' }));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="h-full overflow-y-auto px-8 pb-8">
      <h1 className="mb-6 text-2xl font-semibold">{strings.history.title}</h1>
      {state.status === 'error' && (
        <p role="alert" className="text-red-700 dark:text-red-400">
          {strings.history.loadError}
        </p>
      )}
      {state.status === 'ready' && state.entries.length === 0 && (
        <p className="text-neutral-600 dark:text-neutral-400">{strings.history.empty}</p>
      )}
      {state.status === 'ready' && state.entries.length > 0 && (
        <table data-testid="history-table" className="w-full max-w-4xl text-left text-sm">
          <thead className="border-b border-neutral-200 text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
            <tr>
              <th className="py-2 font-medium">{strings.history.date}</th>
              <th className="py-2 font-medium">{strings.history.kind}</th>
              <th className="py-2 font-medium">{strings.history.categories}</th>
              <th className="py-2 text-right font-medium">{strings.history.items}</th>
              <th className="py-2 text-right font-medium">{strings.history.failed}</th>
              <th className="py-2 text-right font-medium">{strings.history.freed}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {state.entries.map((entry) => (
              <tr key={entry.id}>
                <td className="whitespace-nowrap py-2 pr-4">{dateFormat.format(entry.dateMs)}</td>
                <td className="py-2 pr-4">{strings.history.kinds[entry.kind]}</td>
                <td className="py-2 pr-4">
                  {entry.categories.map((id) => strings.categories[id]).join(', ')}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {numberFormat.format(entry.movedCount)}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {numberFormat.format(entry.failedCount)}
                </td>
                <td className="py-2 text-right font-medium tabular-nums">
                  {formatBytes(entry.bytesFreed)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
