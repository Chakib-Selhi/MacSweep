import { opendirSync, type Dir } from 'node:fs';
import path from 'node:path';
import type { CategoryId } from '../../shared/categories';
import type { CategoryResult, ScanDone, ScanItem, ScanProgress } from '../../shared/types';
import { classifyPath } from '../safety/guard';
import { planCategory, type CategoryPlan, type PlanContext, type Source } from './categories';
import type { ToolDeps } from './tools';
import { Walker } from './walk';

export interface ScanConfig {
  scanId: string;
  /** Real path of the root (the home folder, or a temporary folder in tests). */
  home: string;
  categories: readonly CategoryId[];
  projectDirs: readonly string[];
  exclusions: readonly string[];
  nodeModulesMinAgeDays: number;
  downloadsMinAgeDays: number;
}

export interface ScanHooks {
  emitProgress(progress: ScanProgress): void;
  shouldStop(): boolean;
  now(): number;
}

const PROGRESS_INTERVAL_MS = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
const NODE_MODULES_MAX_DEPTH = 8;

const pathKey = (p: string) => p.normalize('NFC').toLowerCase();

function isUnder(p: string, prefixes: readonly string[]): boolean {
  const k = pathKey(p);
  return prefixes.some((prefix) => k === prefix || k.startsWith(`${prefix}/`));
}

/** A category may only read under the root, never in the blacklist. */
function sourceAllowed(id: CategoryId, p: string, home: string): boolean {
  const verdict = classifyPath(p, [home], { confirmProtected: true });
  return verdict === null || (verdict === 'trash' && id === 'trash');
}

function restrictSources(plan: CategoryPlan, home: string): CategoryPlan | null {
  const sources: Source[] = [];
  for (const source of plan.sources) {
    if (source.kind === 'children') {
      if (sourceAllowed(plan.id, source.dir, home)) sources.push(source);
    } else {
      const kept = (source.kind === 'paths' ? source.paths : source.dirs).filter((p) =>
        sourceAllowed(plan.id, p, home),
      );
      if (source.kind === 'paths') sources.push({ kind: 'paths', paths: kept });
      else if (kept.length > 0) sources.push({ kind: 'node-modules', dirs: kept });
    }
  }
  return sources.length > 0 ? { ...plan, sources } : null;
}

/** Folders another category already reports, so the same bytes are never counted twice. */
function claimedRoots(plans: readonly CategoryPlan[]): Map<string, CategoryId> {
  const claimed = new Map<string, CategoryId>();
  for (const plan of plans) {
    for (const source of plan.sources) {
      const roots =
        source.kind === 'children' ? [source.dir] : source.kind === 'paths' ? source.paths : [];
      for (const root of roots) claimed.set(pathKey(root), plan.id);
    }
  }
  return claimed;
}

export async function runScan(
  config: ScanConfig,
  tools: ToolDeps,
  hooks: ScanHooks,
): Promise<ScanDone> {
  const startedAt = hooks.now();
  const exclusions = config.exclusions.map(pathKey);
  let currentCategory: CategoryId = config.categories[0] ?? 'user-caches';
  let categoryBytes = 0;
  let categoryFilesStart = 0;
  let lastEmit = 0;

  const walker = new Walker({
    isExcluded: (p) => isUnder(p, exclusions) || classifyPath(p, [config.home]) === 'forbidden',
    shouldStop: () => hooks.shouldStop(),
    onTick: (dir) => emit(dir, false),
  });

  function emit(currentDir: string, force: boolean): void {
    const now = hooks.now();
    if (!force && now - lastEmit < PROGRESS_INTERVAL_MS) return;
    lastEmit = now;
    hooks.emitProgress({
      scanId: config.scanId,
      categoryId: currentCategory,
      filesVisited: walker.filesVisited - categoryFilesStart,
      bytesFound: categoryBytes,
      currentDir,
    });
  }

  function listChildren(
    dir: string,
    onEntry: (name: string, isDir: boolean, isLink: boolean) => void,
  ): void {
    let handle: Dir;
    try {
      handle = opendirSync(dir);
    } catch {
      walker.recordDenied(dir);
      return;
    }
    try {
      for (let entry = handle.readSync(); entry !== null; entry = handle.readSync()) {
        onEntry(entry.name, entry.isDirectory(), entry.isSymbolicLink());
      }
    } catch {
      walker.recordDenied(dir);
    } finally {
      handle.closeSync();
    }
  }

  function findNodeModules(projectDir: string): string[] {
    const found: string[] = [];
    const stack: { dir: string; depth: number }[] = [{ dir: projectDir, depth: 0 }];
    while (stack.length > 0 && !walker.checkStop()) {
      const { dir, depth } = stack.pop() as { dir: string; depth: number };
      emit(dir, false);
      listChildren(dir, (name, isDir) => {
        // Dirents report symlinks as such, so linked folders are never entered.
        if (!isDir || name.startsWith('.')) return;
        const child = path.join(dir, name);
        if (isUnder(child, exclusions)) return;
        if (name === 'node_modules') found.push(child);
        else if (depth < NODE_MODULES_MAX_DEPTH) stack.push({ dir: child, depth: depth + 1 });
      });
    }
    return found;
  }

  function candidates(plan: CategoryPlan, claimed: Map<string, CategoryId>): string[] {
    const list: string[] = [];
    for (const source of plan.sources) {
      if (source.kind === 'paths') list.push(...source.paths);
      else if (source.kind === 'node-modules') {
        for (const dir of source.dirs) list.push(...findNodeModules(dir));
      } else {
        listChildren(source.dir, (name, _isDir, isLink) => {
          if (isLink || (source.accept && !source.accept(name))) return;
          const child = path.join(source.dir, name);
          const owner = claimed.get(pathKey(child));
          if (owner && owner !== plan.id) return;
          list.push(child);
        });
      }
    }
    return list.filter((p) => !isUnder(p, exclusions));
  }

  const results: CategoryResult[] = [];
  try {
    const context: PlanContext = {
      home: config.home,
      projectDirs: config.projectDirs,
      nodeModulesMinAgeDays: config.nodeModulesMinAgeDays,
      downloadsMinAgeDays: config.downloadsMinAgeDays,
      tools,
    };
    const plans: CategoryPlan[] = [];
    for (const id of config.categories) {
      if (walker.checkStop()) break;
      // A missing or failing tool hides its category instead of failing the scan.
      const plan = await planCategory(id, context).catch(() => null);
      const restricted = plan && restrictSources(plan, config.home);
      if (restricted) plans.push(restricted);
    }
    const claimed = claimedRoots(plans);

    for (const plan of plans) {
      if (walker.checkStop()) break;
      currentCategory = plan.id;
      categoryBytes = 0;
      categoryFilesStart = walker.filesVisited;
      emit('', true);

      const items: ScanItem[] = [];
      const minAgeMs = plan.minAgeDays === undefined ? 0 : plan.minAgeDays * DAY_MS;
      for (const candidate of candidates(plan, claimed)) {
        if (walker.checkStop()) break;
        emit(candidate, false);
        const measure = walker.measure(candidate);
        if (!measure) continue;
        if (minAgeMs > 0 && hooks.now() - measure.newestMtimeMs < minAgeMs) continue;
        items.push({
          path: candidate,
          sizeBytes: measure.bytes,
          modifiedMs: measure.newestMtimeMs,
          isDirectory: measure.isDirectory,
        });
        categoryBytes += measure.bytes;
      }
      items.sort((a, b) => b.sizeBytes - a.sizeBytes);
      results.push({
        id: plan.id,
        items,
        totalBytes: categoryBytes,
        filesVisited: walker.filesVisited - categoryFilesStart,
      });
      emit('', true);
    }
  } catch (error) {
    return done('failed', error instanceof Error ? error.message : String(error));
  }
  return done(walker.checkStop() ? 'cancelled' : 'completed');

  function done(status: ScanDone['status'], error?: string): ScanDone {
    results.sort((a, b) => b.totalBytes - a.totalBytes);
    return {
      scanId: config.scanId,
      status,
      categories: results,
      deniedCount: walker.deniedCount,
      deniedDirs: [...walker.deniedDirs],
      durationMs: hooks.now() - startedAt,
      ...(error === undefined ? {} : { error }),
    };
  }
}
