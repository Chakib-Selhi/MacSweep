import path from 'node:path';
import type { CategoryId } from '../shared/categories';
import type { ScanDone } from '../shared/types';
import type { ToolRunner } from './scanner/tools';

export interface RunningApp {
  name: string;
  bundleId: string | null;
}

const LSAPPINFO = '/usr/bin/lsappinfo';
const ENTRY = /^\s*\d+\)\s+"(.*)"\s+ASN:/;
const BUNDLE_ID = /^\s*bundleID="(.*)"/;

const XCODE = 'com.apple.dt.Xcode';
const SIMULATOR = 'com.apple.iphonesimulator';

/** Categories whose items belong to one app, named after it or its bundle identifier. */
const NAMED_AFTER_APP = new Set<CategoryId>(['user-caches', 'user-logs']);
const USED_BY_XCODE = new Set<CategoryId>([
  'xcode-derived-data',
  'xcode-archives',
  'ios-device-support',
]);

export function parseLsappinfo(output: string): RunningApp[] {
  const apps: RunningApp[] = [];
  for (const line of output.split('\n')) {
    const entry = ENTRY.exec(line);
    if (entry?.[1] !== undefined) {
      apps.push({ name: entry[1], bundleId: null });
      continue;
    }
    const bundle = BUNDLE_ID.exec(line);
    const last = apps.at(-1);
    if (bundle?.[1] !== undefined && last) last.bundleId = bundle[1];
  }
  return apps;
}

export async function listRunningApps(run: ToolRunner): Promise<RunningApp[]> {
  return parseLsappinfo(await run(LSAPPINFO, ['list']));
}

const lower = (s: string) => s.normalize('NFC').toLowerCase();

/**
 * Name of the running app an item belongs to, or null. Errs on the side of flagging:
 * a false positive only leaves an item unchecked.
 */
export function findOpenApp(
  category: CategoryId,
  itemPath: string,
  apps: readonly RunningApp[],
): string | null {
  const byBundle = (id: string) => apps.find((app) => app.bundleId === id)?.name ?? null;
  if (USED_BY_XCODE.has(category)) return byBundle(XCODE);
  if (category === 'ios-simulators') return byBundle(SIMULATOR);
  if (!NAMED_AFTER_APP.has(category)) return null;

  const base = lower(path.basename(itemPath));
  for (const app of apps) {
    const name = lower(app.name);
    const bundle = app.bundleId ? lower(app.bundleId) : null;
    if (base === name || name.startsWith(`${base} `)) return app.name;
    if (bundle && (base === bundle || base.startsWith(`${bundle}.`))) return app.name;
  }
  return null;
}

export function annotateOpenApps(done: ScanDone, apps: readonly RunningApp[]): ScanDone {
  return {
    ...done,
    categories: done.categories.map((category) => ({
      ...category,
      items: category.items.map((item) => {
        const openApp = findOpenApp(category.id, item.path, apps);
        return openApp ? { ...item, openApp } : item;
      }),
    })),
  };
}
