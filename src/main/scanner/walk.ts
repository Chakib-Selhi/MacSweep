import { lstatSync, opendirSync, type Dir, type Stats } from 'node:fs';
import path from 'node:path';

export interface Measure {
  bytes: number;
  files: number;
  newestMtimeMs: number;
  isDirectory: boolean;
}

export interface WalkerHooks {
  /** Folders never entered nor counted (user exclusions, blacklist). */
  isExcluded(absolutePath: string): boolean;
  shouldStop(): boolean;
  /** Called every few hundred entries; the caller throttles what it sends. */
  onTick(currentDir: string): void;
}

const MAX_DENIED_KEPT = 500;
const TICK_EVERY = 256;

function code(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error ? String(error.code) : undefined;
}

/**
 * Measures disk usage like `du`: allocated blocks, symlinks never followed, hardlinks counted once.
 * Synchronous on purpose: it runs in a worker thread, and sync calls are several times faster than
 * awaiting each lstat. Cancellation is read from shared memory, not from messages.
 */
export class Walker {
  filesVisited = 0;
  deniedCount = 0;
  readonly deniedDirs: string[] = [];
  private readonly seenInodes = new Set<string>();
  private stopped = false;

  constructor(private readonly hooks: WalkerHooks) {}

  measure(target: string): Measure | null {
    let stats: Stats;
    try {
      stats = lstatSync(target);
    } catch (error) {
      if (code(error) !== 'ENOENT') this.recordDenied(target);
      return null;
    }

    const result: Measure = {
      bytes: 0,
      files: 0,
      newestMtimeMs: stats.mtimeMs,
      isDirectory: stats.isDirectory(),
    };
    this.account(stats, result);
    if (!result.isDirectory) return result;

    const stack = [target];
    while (stack.length > 0 && !this.checkStop()) {
      const dir = stack.pop() as string;
      let handle: Dir;
      try {
        handle = opendirSync(dir);
      } catch (error) {
        const errorCode = code(error);
        if (errorCode !== 'ENOENT' && errorCode !== 'ENOTDIR') this.recordDenied(dir);
        continue;
      }
      try {
        for (let entry = handle.readSync(); entry !== null; entry = handle.readSync()) {
          const child = path.join(dir, entry.name);
          let childStats: Stats;
          try {
            childStats = lstatSync(child);
          } catch {
            continue;
          }
          if (childStats.isDirectory()) {
            if (this.hooks.isExcluded(child)) continue;
            stack.push(child);
          }
          this.account(childStats, result);
          this.filesVisited += 1;
          if (this.filesVisited % TICK_EVERY === 0) {
            this.hooks.onTick(dir);
            if (this.checkStop()) break;
          }
        }
      } catch (error) {
        if (code(error) !== 'ENOENT') this.recordDenied(dir);
      } finally {
        handle.closeSync();
      }
    }
    return result;
  }

  checkStop(): boolean {
    if (!this.stopped && this.hooks.shouldStop()) this.stopped = true;
    return this.stopped;
  }

  recordDenied(dir: string): void {
    this.deniedCount += 1;
    if (this.deniedDirs.length < MAX_DENIED_KEPT) this.deniedDirs.push(dir);
  }

  private account(stats: Stats, result: Measure): void {
    if (stats.mtimeMs > result.newestMtimeMs) result.newestMtimeMs = stats.mtimeMs;
    if (!stats.isDirectory() && stats.nlink > 1) {
      const inode = `${stats.dev}:${stats.ino}`;
      if (this.seenInodes.has(inode)) return;
      this.seenInodes.add(inode);
    }
    result.bytes += stats.blocks * 512;
    if (!stats.isDirectory()) result.files += 1;
  }
}
