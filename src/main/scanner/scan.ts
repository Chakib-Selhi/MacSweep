import { opendirSync, type Dir } from 'node:fs';
import path from 'node:path';
import type { CategoryId } from '../../shared/categories';
import type {
  CategoryResult,
  DuplicateGroup,
  ScanDone,
  ScanItem,
  ScanProgress,
} from '../../shared/types';
import { classifyPath, isBlacklisted } from '../safety/guard';
import { planCategory, type CategoryPlan, type PlanContext, type Source } from './categories';
import { findDuplicateGroups, type DuplicateCandidate } from './duplicates';
import { fileKind, isPackage, TopFiles } from './large-files';
import type { ToolDeps } from './tools';
import { walkFiles, Walker } from './walk';

export interface ScanConfig {
  scanId: string;
  /** Real path of the root (the home folder, or a temporary folder in tests). */
  home: string;
  categories: readonly CategoryId[];
  projectDirs: readonly string[];
  exclusions: readonly string[];
  nodeModulesMinAgeDays: number;
  downloadsMinAgeDays: number;
  largeFileThresholdBytes: number;
  duplicateDirs: readonly string[];
  duplicateMinBytes: number;
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

  const isExcluded = (p: string) => isUnder(p, exclusions) || isBlacklisted(p, config.home);
  const walker = new Walker({
    isExcluded,
    shouldStop: () => hooks.shouldStop(),
    onTick: (dir) => emit(dir, false),
  });
  const deniedSeen = new Set<string>();
  const recordDenied = (dir: string) => {
    if (deniedSeen.has(dir)) return;
    deniedSeen.add(dir);
    walker.recordDenied(dir);
  };
  const duplicateGroups: DuplicateGroup[] = [];

  /** Every item says whether it sits in Documents, Desktop or Pictures (D9). */
  function makeItem(
    itemPath: string,
    sizeBytes: number,
    modifiedMs: number,
    isDirectory: boolean,
    extra: Partial<ScanItem> = {},
  ): ScanItem {
    const isProtected = classifyPath(itemPath, [config.home]) === 'protected';
    return {
      path: itemPath,
      sizeBytes,
      modifiedMs,
      isDirectory,
      ...(isProtected ? { protected: true } : {}),
      ...extra,
    };
  }

  function startCategory(id: CategoryId): void {
    currentCategory = id;
    categoryBytes = 0;
    categoryFilesStart = walker.filesVisited;
    emit('', true);
  }

  /** F5: the biggest files of the whole home folder, outside ~/Library, hidden folders and packages. */
  function scanLargeFiles(): CategoryResult {
    startCategory('large-files');
    const top = new TopFiles();
    const library = pathKey(path.join(config.home, 'Library'));
    walkFiles([config.home], {
      skipDir: (dir, name) =>
        name.startsWith('.') || isPackage(name) || pathKey(dir) === library || isExcluded(dir),
      onFile: (file, stats) => {
        walker.filesVisited += 1;
        const sizeBytes = stats.blocks * 512;
        if (sizeBytes >= config.largeFileThresholdBytes) {
          top.add({ path: file, sizeBytes, modifiedMs: stats.mtimeMs });
        }
      },
      onDenied: recordDenied,
      shouldStop: () => walker.checkStop(),
      onTick: (dir) => emit(dir, false),
    });
    const items = top
      .result()
      .filter((file) => classifyPath(file.path, [config.home], { confirmProtected: true }) === null)
      .map((file) =>
        makeItem(file.path, file.sizeBytes, file.modifiedMs, false, {
          fileKind: fileKind(file.path),
        }),
      );
    categoryBytes = items.reduce((sum, item) => sum + item.sizeBytes, 0);
    return {
      id: 'large-files',
      items,
      totalBytes: categoryBytes,
      filesVisited: walker.filesVisited - categoryFilesStart,
    };
  }

  /** F6: identical files in the folders the user chose. The category total is what can be freed. */
  function scanDuplicates(dirs: readonly string[]): CategoryResult {
    startCategory('duplicates');
    // Hard links are the same file, not copies: one path per inode, the first in name order.
    const byInode = new Map<string, DuplicateCandidate>();
    walkFiles(dirs, {
      skipDir: (dir, name) => name.startsWith('.') || isPackage(name) || isExcluded(dir),
      onFile: (file, stats) => {
        walker.filesVisited += 1;
        if (stats.size < config.duplicateMinBytes) return;
        const inode = `${stats.dev}:${stats.ino}`;
        const known = byInode.get(inode);
        if (known && known.path.localeCompare(file) <= 0) return;
        byInode.set(inode, {
          path: file,
          size: stats.size,
          allocatedBytes: stats.blocks * 512,
          modifiedMs: stats.mtimeMs,
        });
      },
      onDenied: recordDenied,
      shouldStop: () => walker.checkStop(),
      onTick: (dir) => emit(dir, false),
    });

    const items: ScanItem[] = [];
    for (const group of findDuplicateGroups(
      [...byInode.values()],
      () => walker.checkStop(),
      (p) => emit(p, false),
    )) {
      const id = group.hash.slice(0, 16);
      const files = group.files.map((file) =>
        makeItem(file.path, file.allocatedBytes, file.modifiedMs, false, { groupId: id }),
      );
      duplicateGroups.push({ id, sizeBytes: files[0]?.sizeBytes ?? 0, files });
      items.push(...files);
      categoryBytes += files.slice(1).reduce((sum, file) => sum + file.sizeBytes, 0);
    }
    duplicateGroups.sort((a, b) => b.sizeBytes * b.files.length - a.sizeBytes * a.files.length);
    return {
      id: 'duplicates',
      items,
      totalBytes: categoryBytes,
      filesVisited: walker.filesVisited - categoryFilesStart,
    };
  }

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
      startCategory(plan.id);

      const items: ScanItem[] = [];
      const minAgeMs = plan.minAgeDays === undefined ? 0 : plan.minAgeDays * DAY_MS;
      for (const candidate of candidates(plan, claimed)) {
        if (walker.checkStop()) break;
        emit(candidate, false);
        const measure = walker.measure(candidate);
        if (!measure) continue;
        if (minAgeMs > 0 && hooks.now() - measure.newestMtimeMs < minAgeMs) continue;
        items.push(makeItem(candidate, measure.bytes, measure.newestMtimeMs, measure.isDirectory));
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

    if (config.categories.includes('large-files') && !walker.checkStop()) {
      results.push(scanLargeFiles());
    }
    // Chosen folders only need to be readable: Documents itself is a valid choice.
    const duplicateDirs = config.duplicateDirs.filter(
      (dir) =>
        classifyPath(dir, [config.home]) !== 'outside-root' && !isBlacklisted(dir, config.home),
    );
    if (
      config.categories.includes('duplicates') &&
      duplicateDirs.length > 0 &&
      !walker.checkStop()
    ) {
      results.push(scanDuplicates(duplicateDirs));
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
      root: config.home,
      categories: results,
      duplicateGroups,
      deniedCount: walker.deniedCount,
      deniedDirs: [...walker.deniedDirs],
      durationMs: hooks.now() - startedAt,
      ...(error === undefined ? {} : { error }),
    };
  }
}
