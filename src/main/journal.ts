import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export interface JournalEntry {
  action: 'trash' | 'empty-trash';
  path: string;
  sizeBytes: number;
}

export interface Journal {
  record(entry: JournalEntry): Promise<void>;
}

/** One JSON line per move or deletion, one file per day: original path, size and date. */
export function createJournal(dir: string, now: () => Date = () => new Date()): Journal {
  let ready: Promise<unknown> | null = null;
  return {
    async record(entry) {
      ready ??= mkdir(dir, { recursive: true });
      await ready;
      const date = now();
      const file = path.join(dir, `macsweep-${date.toISOString().slice(0, 10)}.jsonl`);
      await appendFile(file, `${JSON.stringify({ date: date.toISOString(), ...entry })}\n`);
    },
  };
}
