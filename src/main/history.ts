import type { HistoryEntry, Settings } from '../shared/types';

/** Rule 7: the first launch simulates; the user has to turn real cleaning on. */
export const DEFAULT_SETTINGS: Settings = { dryRun: true };

export const MAX_HISTORY = 500;

export function appendHistory(
  history: readonly HistoryEntry[],
  entry: HistoryEntry,
): HistoryEntry[] {
  return [entry, ...history].slice(0, MAX_HISTORY);
}
