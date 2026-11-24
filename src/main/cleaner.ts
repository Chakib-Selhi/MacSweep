import type { CleanFailure, CleanProgress, CleanReport, CleanedItem } from '../shared/types';
import type { Journal } from './journal';
import { canBelongToApp, findOpenApp, type RunningApp } from './running-apps';
import { GuardInputError, type Guard } from './safety/guard';
import type { ScanRegistry } from './scan-registry';

export interface CleanDeps {
  guard: Guard;
  registry: ScanRegistry;
  /** shell.trashItem in the app; a move into a test Trash during automated tests. */
  moveToTrash(path: string): Promise<void>;
  listRunningApps(): Promise<RunningApp[]>;
  journal: Journal;
  onProgress(progress: CleanProgress): void;
  now(): number;
}

const MAX_PATHS = 200_000;
const PROGRESS_INTERVAL_MS = 100;

function describe(input: unknown): string {
  return typeof input === 'string' ? input : `<${typeof input}>`;
}

/**
 * Moves validated paths to the Trash, one by one. Every path goes through the guard, must come
 * from the latest scan, and must not belong to a running app. A failure is skipped and reported.
 */
export async function cleanPaths(
  raw: unknown,
  dryRun: boolean,
  deps: CleanDeps,
): Promise<CleanReport> {
  if (!Array.isArray(raw)) throw new GuardInputError('La liste de chemins doit être un tableau');
  if (raw.length > MAX_PATHS) throw new GuardInputError('Trop de chemins');
  const inputs = raw as unknown[];

  const startedAt = deps.now();
  const apps = await deps.listRunningApps().catch(() => null);
  const moved: CleanedItem[] = [];
  const failed: CleanFailure[] = [];
  const handled = new Set<string>();
  let lastProgress = 0;

  const progress = (done: number, currentPath: string, force = false) => {
    const now = deps.now();
    if (!force && now - lastProgress < PROGRESS_INTERVAL_MS) return;
    lastProgress = now;
    deps.onProgress({ done, total: inputs.length, currentPath });
  };

  for (const [index, input] of inputs.entries()) {
    progress(index, describe(input));
    const checked = await deps.guard.checkTrashable(input);
    if (!checked.ok) {
      failed.push({ path: describe(input), reason: checked.reason });
      continue;
    }
    const target = checked.path;
    if (handled.has(target)) continue;
    handled.add(target);

    const scanned = deps.registry.get(target);
    if (!scanned) {
      failed.push({ path: target, reason: 'not-scanned' });
      continue;
    }
    if (canBelongToApp(scanned.categoryId)) {
      if (!apps) {
        failed.push({ path: target, reason: 'app-check-failed' });
        continue;
      }
      if (findOpenApp(scanned.categoryId, target, apps)) {
        failed.push({ path: target, reason: 'app-open' });
        continue;
      }
    }

    if (!dryRun) {
      try {
        await deps.moveToTrash(target);
      } catch (error) {
        failed.push({
          path: target,
          reason: 'trash-failed',
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      deps.registry.forget(target);
      await deps.journal.record({ action: 'trash', path: target, sizeBytes: scanned.sizeBytes });
    }
    moved.push({ path: target, sizeBytes: scanned.sizeBytes, categoryId: scanned.categoryId });
  }
  progress(inputs.length, '', true);

  return {
    dryRun,
    moved,
    failed,
    bytesFreed: moved.reduce((sum, item) => sum + item.sizeBytes, 0),
    durationMs: deps.now() - startedAt,
  };
}
