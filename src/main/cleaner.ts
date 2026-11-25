import { CATEGORY_META } from '../shared/categories';
import type {
  CleanFailure,
  CleanFailureReason,
  CleanProgress,
  CleanReport,
  CleanedItem,
} from '../shared/types';
import type { Journal } from './journal';
import { canBelongToApp, findOpenApp, type RunningApp } from './running-apps';
import { GuardInputError, type Guard } from './safety/guard';
import type { RegisteredItem } from './scan-registry';

/** What a clean may touch: the latest scan, or the latest disk map. */
export interface CleanRegistry {
  get(path: string): RegisteredItem | undefined;
  groupSize(groupId: string): number;
  forget(path: string): void;
}

export interface CleanDeps {
  guard: Guard;
  registry: CleanRegistry;
  /** A further rule for this source, checked right after the guard (the disk map's read-only parts). */
  extraRefusal?(path: string): CleanFailureReason | null;
  /** shell.trashItem in the app; a move into a test Trash during automated tests. */
  moveToTrash(path: string): Promise<void>;
  listRunningApps(): Promise<RunningApp[]>;
  journal: Journal;
  /** Folders of the exclusion list, as saved now (they may have changed since the scan). */
  exclusions?: readonly string[];
  onProgress(progress: CleanProgress): void;
  now(): number;
}

const MAX_PATHS = 200_000;
const PROGRESS_INTERVAL_MS = 100;

function describe(input: unknown): string {
  return typeof input === 'string' ? input : `<${typeof input}>`;
}

export interface CleanOptions {
  dryRun: boolean;
  confirmProtected?: boolean;
  confirmHighRisk?: boolean;
}

/**
 * Moves validated paths to the Trash, one by one. Every path goes through the guard, must come
 * from the latest scan, and must not belong to a running app. A failure is skipped and reported.
 */
export async function cleanPaths(
  raw: unknown,
  options: CleanOptions,
  deps: CleanDeps,
): Promise<CleanReport> {
  const { dryRun } = options;
  if (!Array.isArray(raw)) throw new GuardInputError('La liste de chemins doit être un tableau');
  if (raw.length > MAX_PATHS) throw new GuardInputError('Trop de chemins');
  const inputs = raw as unknown[];

  const startedAt = deps.now();
  const apps = await deps.listRunningApps().catch(() => null);
  const moved: CleanedItem[] = [];
  const failed: CleanFailure[] = [];
  const handled = new Set<string>();
  /** Duplicates: copies of each group still on disk once this request is done. */
  const groupRemaining = new Map<string, number>();
  let lastProgress = 0;

  const progress = (done: number, currentPath: string, force = false) => {
    const now = deps.now();
    if (!force && now - lastProgress < PROGRESS_INTERVAL_MS) return;
    lastProgress = now;
    deps.onProgress({ done, total: inputs.length, currentPath });
  };

  for (const [index, input] of inputs.entries()) {
    progress(index, describe(input));
    const checked = await deps.guard.checkTrashable(input, {
      confirmProtected: options.confirmProtected === true,
    });
    if (!checked.ok) {
      failed.push({ path: describe(input), reason: checked.reason });
      continue;
    }
    const target = checked.path;
    if (handled.has(target)) continue;
    handled.add(target);
    const extra = deps.extraRefusal?.(target) ?? null;
    if (extra) {
      failed.push({ path: target, reason: extra });
      continue;
    }
    if (deps.exclusions?.some((dir) => target === dir || target.startsWith(`${dir}/`))) {
      failed.push({ path: target, reason: 'excluded' });
      continue;
    }

    const scanned = deps.registry.get(target);
    if (!scanned) {
      failed.push({ path: target, reason: 'not-scanned' });
      continue;
    }
    const meta = CATEGORY_META[scanned.categoryId];
    if (meta.infoOnly) {
      failed.push({ path: target, reason: 'info-only' });
      continue;
    }
    if (meta.risk === 'high' && options.confirmHighRisk !== true) {
      failed.push({ path: target, reason: 'needs-confirmation' });
      continue;
    }
    if (scanned.groupId) {
      const remaining =
        groupRemaining.get(scanned.groupId) ?? deps.registry.groupSize(scanned.groupId);
      // Whatever the request says, one copy of each group stays on disk.
      if (remaining <= 1) {
        failed.push({ path: target, reason: 'last-copy' });
        continue;
      }
      groupRemaining.set(scanned.groupId, remaining - 1);
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
