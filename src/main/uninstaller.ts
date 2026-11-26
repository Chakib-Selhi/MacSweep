import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import type {
  AppInfo,
  AppLeftover,
  CleanFailure,
  CleanReport,
  CleanedItem,
  LeftoverKind,
  UninstallRequest,
} from '../shared/types';
import type { Journal } from './journal';
import type { RunningApp } from './running-apps';
import type { Guard, GuardResult } from './safety/guard';

export interface AppBundle {
  path: string;
  name: string;
  bundleId: string | null;
  location: AppInfo['location'];
}

export type RegisteredApp = AppBundle & { sizeBytes: number; leftovers: AppLeftover[] };

/** Bundles directly inside each applications folder; nested ones are never listed (D29). */
export async function listAppBundles(
  dirs: { system: string; user: string },
  readBundleId: (appPath: string) => Promise<string | null>,
): Promise<AppBundle[]> {
  const bundles: AppBundle[] = [];
  for (const [location, dir] of [
    ['system', dirs.system],
    ['user', dirs.user],
  ] as const) {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.toLowerCase().endsWith('.app')) continue;
      const appPath = path.join(dir, name);
      const stats = await lstat(appPath).catch(() => null);
      if (!stats?.isDirectory()) continue;
      bundles.push({
        path: appPath,
        name: name.slice(0, -'.app'.length),
        bundleId: await readBundleId(appPath).catch(() => null),
        location,
      });
    }
  }
  return bundles.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

type Matcher = (entry: string, id: string | null, name: string | null) => boolean;

interface LeftoverRule {
  dir: string;
  kind: LeftoverKind;
  defaultChecked: boolean;
  matches: Matcher;
}

const byId =
  (suffix = ''): Matcher =>
  (entry, id) =>
    id !== null && entry === id + suffix;
const byName: Matcher = (entry, _id, name) => name !== null && entry === name;
const either =
  (...matchers: Matcher[]): Matcher =>
  (entry, id, name) =>
    matchers.some((match) => match(entry, id, name));
/** `<id>.something.plist`: the dot keeps a longer identifier (com.acme.outil2) from matching. */
const plistFamily: Matcher = (entry, id) =>
  id !== null &&
  entry.endsWith('.plist') &&
  (entry === `${id}.plist` || entry.startsWith(`${id}.`));

/**
 * Where an app leaves data in ~/Library. Rebuildable data (caches, window state, logs) is checked
 * by default; settings and the app's own data are left unchecked (D47).
 */
const RULES: LeftoverRule[] = [
  { dir: 'Caches', kind: 'caches', defaultChecked: true, matches: either(byId(), byName) },
  { dir: 'Preferences', kind: 'preferences', defaultChecked: false, matches: byId('.plist') },
  { dir: 'Preferences/ByHost', kind: 'preferences', defaultChecked: false, matches: plistFamily },
  {
    dir: 'Application Support',
    kind: 'app-support',
    defaultChecked: false,
    matches: either(byId(), byName),
  },
  { dir: 'Containers', kind: 'containers', defaultChecked: false, matches: byId() },
  {
    dir: 'Group Containers',
    kind: 'group-containers',
    defaultChecked: false,
    // Named `<team id>.<bundle id>`.
    matches: (entry, id) => id !== null && entry.endsWith(`.${id}`),
  },
  {
    dir: 'Saved Application State',
    kind: 'saved-state',
    defaultChecked: true,
    matches: byId('.savedstate'),
  },
  {
    dir: 'HTTPStorages',
    kind: 'web-data',
    defaultChecked: true,
    matches: either(byId(), byId('.binarycookies')),
  },
  { dir: 'WebKit', kind: 'web-data', defaultChecked: true, matches: byId() },
  { dir: 'Cookies', kind: 'web-data', defaultChecked: true, matches: byId('.binarycookies') },
  { dir: 'Logs', kind: 'logs', defaultChecked: true, matches: either(byId(), byName) },
  { dir: 'LaunchAgents', kind: 'launch-agents', defaultChecked: true, matches: plistFamily },
];

/** Shorter names ("AB", "Go") could match another app's folder: they are never used. */
const MIN_NAME_LENGTH = 3;

const fold = (value: string) => value.normalize('NFC').toLowerCase();

export async function findLeftovers(
  home: string,
  bundleId: string | null,
  name: string,
): Promise<Omit<AppLeftover, 'sizeBytes'>[]> {
  const id = bundleId ? fold(bundleId) : null;
  const appName = name.length >= MIN_NAME_LENGTH ? fold(name) : null;
  const found: Omit<AppLeftover, 'sizeBytes'>[] = [];
  const seen = new Set<string>();
  for (const rule of RULES) {
    const dir = path.join(home, 'Library', rule.dir);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!rule.matches(fold(entry), id, appName)) continue;
      const leftover = path.join(dir, entry);
      if (seen.has(leftover)) continue;
      seen.add(leftover);
      found.push({ path: leftover, kind: rule.kind, defaultChecked: rule.defaultChecked });
    }
  }
  return found;
}

/** The latest app list, kept in the main process: only what it shows can be uninstalled. */
export class AppsRegistry {
  private apps = new Map<string, RegisteredApp>();

  set(app: RegisteredApp): void {
    this.apps.set(app.path, app);
  }

  clear(): void {
    this.apps = new Map();
  }

  get(appPath: string): RegisteredApp | undefined {
    return this.apps.get(appPath);
  }

  forget(appPath: string): void {
    this.apps.delete(appPath);
  }
}

export function isAppRunning(app: AppBundle, running: readonly RunningApp[]): boolean {
  return running.some(
    (candidate) =>
      (app.bundleId !== null &&
        candidate.bundleId !== null &&
        fold(candidate.bundleId) === fold(app.bundleId)) ||
      fold(candidate.name) === fold(app.name),
  );
}

export interface UninstallDeps {
  registry: AppsRegistry;
  guard: Guard;
  /** checkUninstallable from guard.ts, bound to the applications folders. */
  check(appPath: string, confirmed: boolean): Promise<GuardResult>;
  listRunningApps(): Promise<RunningApp[]>;
  moveToTrash(target: string): Promise<void>;
  journal: Journal;
  now(): number;
}

/**
 * Sends an app and the chosen leftovers to the Trash. The app goes first: if macOS refuses it,
 * its leftovers stay where they are, so the app is never left without its settings.
 */
export async function uninstallApp(
  appPath: unknown,
  request: UninstallRequest,
  deps: UninstallDeps,
): Promise<CleanReport> {
  const startedAt = deps.now();
  const moved: CleanedItem[] = [];
  const failed: CleanFailure[] = [];
  const report = (): CleanReport => ({
    dryRun: request.dryRun,
    moved,
    failed,
    bytesFreed: moved.reduce((sum, item) => sum + item.sizeBytes, 0),
    durationMs: deps.now() - startedAt,
  });

  if (typeof appPath !== 'string') {
    failed.push({ path: '<invalide>', reason: 'invalid-input' });
    return report();
  }
  const app = deps.registry.get(appPath);
  if (!app) {
    failed.push({ path: appPath, reason: 'not-scanned' });
    return report();
  }
  const running = await deps.listRunningApps().catch(() => null);
  if (!running) {
    failed.push({ path: appPath, reason: 'app-check-failed' });
    return report();
  }
  if (isAppRunning(app, running)) {
    failed.push({ path: appPath, reason: 'app-open' });
    return report();
  }
  const checked = await deps.check(appPath, request.confirmName === app.name);
  if (!checked.ok) {
    failed.push({ path: appPath, reason: checked.reason });
    return report();
  }

  const leftovers: AppLeftover[] = [];
  for (const target of new Set(request.leftovers)) {
    const leftover = app.leftovers.find((item) => item.path === target);
    if (!leftover) {
      failed.push({ path: target, reason: 'not-scanned' });
      continue;
    }
    const allowed = await deps.guard.checkTrashable(target);
    if (!allowed.ok) {
      failed.push({ path: target, reason: allowed.reason });
      continue;
    }
    leftovers.push(leftover);
  }

  const items = [
    { path: checked.path, sizeBytes: app.sizeBytes, isApp: true },
    ...leftovers.map((item) => ({ path: item.path, sizeBytes: item.sizeBytes, isApp: false })),
  ];
  for (const item of items) {
    if (!request.dryRun) {
      try {
        await deps.moveToTrash(item.path);
      } catch (error) {
        failed.push({
          path: item.path,
          reason: 'trash-failed',
          message: error instanceof Error ? error.message : String(error),
        });
        if (item.isApp) return report();
        continue;
      }
      await deps.journal.record({ action: 'trash', path: item.path, sizeBytes: item.sizeBytes });
    }
    moved.push({ path: item.path, sizeBytes: item.sizeBytes, categoryId: 'uninstaller' });
  }
  if (!request.dryRun) deps.registry.forget(app.path);
  return report();
}
