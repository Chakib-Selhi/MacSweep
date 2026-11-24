import { lstat } from 'node:fs/promises';
import path from 'node:path';
import type { CategoryId } from '../../shared/categories';
import { BREW_LOCATIONS, XCODE_SELECT, XCRUN, type ToolDeps } from './tools';

/** Where a category finds its items. Items are measured whole; symlinks are never followed. */
export type Source =
  /** Each entry directly inside `dir` is one item. */
  | { kind: 'children'; dir: string; accept?: (name: string) => boolean }
  /** Each listed path is one item. */
  | { kind: 'paths'; paths: string[] }
  /** Every `node_modules` folder found under these project folders is one item. */
  | { kind: 'node-modules'; dirs: string[] };

export interface CategoryPlan {
  id: CategoryId;
  sources: Source[];
  /** Items modified more recently than this are left out. */
  minAgeDays?: number;
}

export interface PlanContext {
  home: string;
  projectDirs: readonly string[];
  nodeModulesMinAgeDays: number;
  downloadsMinAgeDays: number;
  tools: ToolDeps;
}

const INSTALLER_EXTENSIONS = /\.(dmg|pkg|zip)$/i;
const SIMULATOR_UDID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;
const OWN_CACHE_NAMES = new Set(['macsweep']);

async function isRealDir(p: string): Promise<boolean> {
  try {
    const stats = await lstat(p);
    return stats.isDirectory() && !stats.isSymbolicLink();
  } catch {
    return false;
  }
}

async function existingDirs(paths: readonly string[]): Promise<string[]> {
  const checks = await Promise.all(paths.map(async (p) => ((await isRealDir(p)) ? p : null)));
  return checks.filter((p): p is string => p !== null);
}

async function childrenOf(
  id: CategoryId,
  dir: string,
  accept?: (name: string) => boolean,
): Promise<CategoryPlan | null> {
  if (!(await isRealDir(dir))) return null;
  return { id, sources: [accept ? { kind: 'children', dir, accept } : { kind: 'children', dir }] };
}

async function pathsPlan(id: CategoryId, candidates: string[]): Promise<CategoryPlan | null> {
  const paths = await existingDirs(candidates);
  return paths.length > 0 ? { id, sources: [{ kind: 'paths', paths }] } : null;
}

export function parseUnavailableSimulators(json: string): string[] {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || !('devices' in parsed)) return [];
  const { devices } = parsed;
  if (typeof devices !== 'object' || devices === null) return [];

  const udids: string[] = [];
  for (const list of Object.values(devices)) {
    if (!Array.isArray(list)) continue;
    for (const device of list as unknown[]) {
      if (typeof device !== 'object' || device === null) continue;
      const { udid, isAvailable } = device as { udid?: unknown; isAvailable?: unknown };
      if (typeof udid === 'string' && SIMULATOR_UDID.test(udid) && isAvailable !== true) {
        udids.push(udid);
      }
    }
  }
  return udids;
}

async function simulatorsPlan(ctx: PlanContext): Promise<CategoryPlan | null> {
  const devicesDir = path.join(ctx.home, 'Library/Developer/CoreSimulator/Devices');
  if (!(await isRealDir(devicesDir))) return null;
  // Without developer tools, xcrun would pop up an install dialog: check them first.
  await ctx.tools.run(XCODE_SELECT, ['-p']);
  const json = await ctx.tools.run(XCRUN, ['simctl', 'list', 'devices', 'unavailable', '-j']);
  const candidates = parseUnavailableSimulators(json).map((udid) => path.join(devicesDir, udid));
  return {
    id: 'ios-simulators',
    sources: [{ kind: 'paths', paths: await existingDirs(candidates) }],
  };
}

async function homebrewPlan(ctx: PlanContext): Promise<CategoryPlan | null> {
  const brew = await ctx.tools.findExecutable(BREW_LOCATIONS);
  if (!brew) return null;
  const cacheDir = (await ctx.tools.run(brew, ['--cache'])).trim();
  if (!path.isAbsolute(cacheDir)) return null;
  return childrenOf('homebrew-cache', cacheDir);
}

/** Resolves a category. Returns null when its tool or folder is missing: it is then hidden. */
export async function planCategory(id: CategoryId, ctx: PlanContext): Promise<CategoryPlan | null> {
  const home = (relative: string) => path.join(ctx.home, relative);
  switch (id) {
    case 'user-caches':
      return childrenOf(
        id,
        home('Library/Caches'),
        (name) => !OWN_CACHE_NAMES.has(name.toLowerCase()),
      );
    case 'user-logs':
      return childrenOf(id, home('Library/Logs'));
    case 'xcode-derived-data':
      return childrenOf(id, home('Library/Developer/Xcode/DerivedData'));
    case 'xcode-archives':
      return childrenOf(id, home('Library/Developer/Xcode/Archives'));
    case 'ios-simulators':
      return simulatorsPlan(ctx);
    case 'ios-device-support':
      return childrenOf(id, home('Library/Developer/Xcode/iOS DeviceSupport'));
    case 'js-package-caches':
      return pathsPlan(id, [
        home('.npm/_cacache'),
        home('Library/Caches/Yarn'),
        home('Library/pnpm/store'),
      ]);
    case 'homebrew-cache':
      return homebrewPlan(ctx);
    case 'jvm-caches':
      return pathsPlan(id, [home('.gradle/caches'), home('.m2/repository')]);
    case 'node-modules': {
      const dirs = await existingDirs(ctx.projectDirs);
      if (dirs.length === 0) return null;
      return {
        id,
        sources: [{ kind: 'node-modules', dirs }],
        minAgeDays: ctx.nodeModulesMinAgeDays,
      };
    }
    case 'downloaded-installers': {
      const plan = await childrenOf(id, home('Downloads'), (name) =>
        INSTALLER_EXTENSIONS.test(name),
      );
      return plan && { ...plan, minAgeDays: ctx.downloadsMinAgeDays };
    }
    case 'trash':
      return childrenOf(id, home('.Trash'));
  }
}
