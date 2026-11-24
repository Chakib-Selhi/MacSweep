import { createHash } from 'node:crypto';
import { closeSync, openSync, readSync } from 'node:fs';

export const PARTIAL_HASH_BYTES = 64 * 1024;
const CHUNK_BYTES = 1024 * 1024;

export interface DuplicateCandidate {
  path: string;
  /** Logical size: identical content means identical length. */
  size: number;
  /** Space the file takes on disk, as shown to the user. */
  allocatedBytes: number;
  modifiedMs: number;
}

export interface FoundGroup {
  hash: string;
  files: DuplicateCandidate[];
}

/**
 * SHA-256 of the first `limit` bytes (or the whole file), read synchronously in chunks.
 * Returns null if the file cannot be read or the scan is stopped midway.
 */
export function hashFile(
  filePath: string,
  limit: number,
  shouldStop: () => boolean,
): string | null {
  let fd: number;
  try {
    fd = openSync(filePath, 'r');
  } catch {
    return null;
  }
  try {
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(Math.min(CHUNK_BYTES, limit));
    let remaining = limit;
    while (remaining > 0) {
      if (shouldStop()) return null;
      const read = readSync(fd, buffer, 0, Math.min(buffer.length, remaining), null);
      if (read === 0) break;
      hash.update(buffer.subarray(0, read));
      remaining -= read;
    }
    return hash.digest('hex');
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

function groupBy<T>(items: readonly T[], key: (item: T) => string | null): T[][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (k === null) continue;
    const group = groups.get(k);
    if (group) group.push(item);
    else groups.set(k, [item]);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

/**
 * The PRD's three passes: same size, then same first 64 KB, then same full SHA-256.
 * Each pass only reads the files still in a group of two or more. Files are sorted oldest first.
 */
export function findDuplicateGroups(
  candidates: readonly DuplicateCandidate[],
  shouldStop: () => boolean,
  onProgress: (currentPath: string) => void = () => undefined,
): FoundGroup[] {
  const found: FoundGroup[] = [];
  for (const sameSize of groupBy(candidates, (file) => String(file.size))) {
    if (shouldStop()) break;
    const samePrefix = groupBy(sameSize, (file) => {
      onProgress(file.path);
      return hashFile(file.path, PARTIAL_HASH_BYTES, shouldStop);
    });
    for (const group of samePrefix) {
      const size = group[0]?.size ?? 0;
      const byFullHash = new Map<string, DuplicateCandidate[]>();
      for (const file of group) {
        // Below the partial size, the first hash already covered the whole file.
        const full =
          size <= PARTIAL_HASH_BYTES
            ? hashFile(file.path, PARTIAL_HASH_BYTES, shouldStop)
            : (onProgress(file.path), hashFile(file.path, size, shouldStop));
        if (full === null) continue;
        byFullHash.set(full, [...(byFullHash.get(full) ?? []), file]);
      }
      for (const [hash, files] of byFullHash) {
        if (files.length < 2) continue;
        files.sort((a, b) => a.modifiedMs - b.modifiedMs || a.path.localeCompare(b.path));
        found.push({ hash, files });
      }
    }
  }
  return found;
}
