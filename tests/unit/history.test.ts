import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from '../../src/shared/types';
import { appendHistory, DEFAULT_SETTINGS, MAX_HISTORY } from '../../src/main/history';

const entry = (id: string): HistoryEntry => ({
  id,
  dateMs: 0,
  kind: 'clean',
  categories: ['user-caches'],
  bytesFreed: 1,
  movedCount: 1,
  failedCount: 0,
});

describe('DEFAULT_SETTINGS', () => {
  it('active le mode simulation au premier lancement', () => {
    expect(DEFAULT_SETTINGS.dryRun).toBe(true);
  });
});

describe('appendHistory', () => {
  it('ajoute en tête, du plus récent au plus ancien', () => {
    expect(appendHistory([entry('a')], entry('b')).map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('garde au plus MAX_HISTORY entrées', () => {
    const full = Array.from({ length: MAX_HISTORY }, (_, i) => entry(String(i)));
    const next = appendHistory(full, entry('nouveau'));
    expect(next).toHaveLength(MAX_HISTORY);
    expect(next[0]?.id).toBe('nouveau');
  });
});
