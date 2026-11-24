import type { HistoryEntry, Settings } from '../shared/types';

/** PRD defaults. Rule 7: the first launch simulates; the user has to turn real cleaning on. */
export const DEFAULT_SETTINGS: Settings = {
  dryRun: true,
  exclusions: [],
  largeFileThresholdBytes: 500_000_000,
  downloadsMinAgeDays: 14,
  nodeModulesMinAgeDays: 30,
  projectDirs: [],
  duplicateDirs: [],
  duplicateMinBytes: 1_000_000,
};

export const MAX_HISTORY = 500;

export function appendHistory(
  history: readonly HistoryEntry[],
  entry: HistoryEntry,
): HistoryEntry[] {
  return [entry, ...history].slice(0, MAX_HISTORY);
}
