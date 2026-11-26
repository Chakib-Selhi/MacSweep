import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { JournalEntry } from '../../src/main/journal';
import { checkUninstallable, createGuard, type Guard } from '../../src/main/safety/guard';
import {
  AppsRegistry,
  findLeftovers,
  listAppBundles,
  uninstallApp,
  type UninstallDeps,
} from '../../src/main/uninstaller';

// Fake /Applications and fake home folder in the temporary directory (rule 5).
let base: string;
let home: string;
let apps: string;
let guard: Guard;
const uid = process.getuid?.() ?? 501;
const ids: Record<string, string> = { 'Outil.app': 'com.acme.outil', 'AB.app': 'com.acme.ab' };
const readBundleId = (appPath: string) => Promise.resolve(ids[path.basename(appPath)] ?? null);

const lib = (...parts: string[]) => path.join(home, 'Library', ...parts);
const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

async function file(target: string, content = 'x'): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'macsweep-apps-')));
  home = path.join(base, 'home');
  apps = path.join(base, 'Applications');
  await mkdir(home, { recursive: true });
  guard = await createGuard({ root: home });
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

beforeEach(async () => {
  await rm(apps, { recursive: true, force: true });
  await rm(path.join(home, 'Library'), { recursive: true, force: true });
  await rm(path.join(home, '.Trash'), { recursive: true, force: true });
  await file(path.join(apps, 'Outil.app/Contents/MacOS/outil'), 'binaire');
  await file(path.join(apps, 'AB.app/Contents/MacOS/ab'));
  await file(path.join(apps, 'Dossier/Imbriquee.app/Contents/MacOS/x'));
  await file(lib('Caches/com.acme.outil/cache.db'));
  await file(lib('Caches/com.acme.outilplus/cache.db'));
  await file(lib('Preferences/com.acme.outil.plist'));
  await file(lib('Preferences/com.acme.outil2.plist'));
  await file(lib('Preferences/ByHost/com.acme.outil.0000-1111.plist'));
  await file(lib('Application Support/Outil/donnees.sqlite'));
  await file(lib('Application Support/Outils/autre'));
  await file(lib('Containers/com.acme.outil/Data/x'));
  await file(lib('Group Containers/ABCDE12345.com.acme.outil/x'));
  await file(lib('Saved Application State/com.acme.outil.savedState/x'));
  await file(lib('HTTPStorages/com.acme.outil/x'));
  await file(lib('Logs/Outil/journal.log'));
  await file(lib('LaunchAgents/com.acme.outil.helper.plist'));
  await file(lib('Application Support/AB/x'));
});

describe('listAppBundles', () => {
  it('liste les apps directement dans les dossiers Applications', async () => {
    const list = await listAppBundles(
      { system: apps, user: path.join(home, 'Applications') },
      readBundleId,
    );
    expect(list.map((app) => app.name).sort()).toEqual(['AB', 'Outil']);
    expect(list.find((app) => app.name === 'Outil')).toMatchObject({
      path: path.join(apps, 'Outil.app'),
      bundleId: 'com.acme.outil',
      location: 'system',
    });
  });
});

describe('findLeftovers', () => {
  it('trouve les restes par identifiant ou par nom exact, sans les voisins', async () => {
    const found = await findLeftovers(home, 'com.acme.outil', 'Outil');
    expect(found.map((item) => path.relative(home, item.path)).sort()).toEqual(
      [
        'Library/Application Support/Outil',
        'Library/Caches/com.acme.outil',
        'Library/Containers/com.acme.outil',
        'Library/Group Containers/ABCDE12345.com.acme.outil',
        'Library/HTTPStorages/com.acme.outil',
        'Library/LaunchAgents/com.acme.outil.helper.plist',
        'Library/Logs/Outil',
        'Library/Preferences/ByHost/com.acme.outil.0000-1111.plist',
        'Library/Preferences/com.acme.outil.plist',
        'Library/Saved Application State/com.acme.outil.savedState',
      ].sort(),
    );
  });

  it('laisse décochées les données que l’utilisateur peut vouloir garder', async () => {
    const found = await findLeftovers(home, 'com.acme.outil', 'Outil');
    const checked = (kind: string) => found.find((item) => item.kind === kind)?.defaultChecked;
    expect(checked('caches')).toBe(true);
    expect(checked('saved-state')).toBe(true);
    expect(checked('app-support')).toBe(false);
    expect(checked('containers')).toBe(false);
    expect(checked('preferences')).toBe(false);
  });

  it('ne cherche pas par nom quand il est trop court pour être sûr', async () => {
    const found = await findLeftovers(home, 'com.acme.ab', 'AB');
    expect(found).toEqual([]);
  });
});

describe('uninstallApp', () => {
  const moved: string[] = [];
  const journal: JournalEntry[] = [];

  async function setup(running: { name: string; bundleId: string | null }[] = []) {
    moved.length = 0;
    journal.length = 0;
    const registry = new AppsRegistry();
    const list = await listAppBundles(
      { system: apps, user: path.join(home, 'Applications') },
      readBundleId,
    );
    for (const app of list) {
      const leftovers = await findLeftovers(home, app.bundleId, app.name);
      registry.set({
        ...app,
        sizeBytes: 100,
        leftovers: leftovers.map((l) => ({ ...l, sizeBytes: 10 })),
      });
    }
    const deps: UninstallDeps = {
      registry,
      guard,
      check: (appPath, confirmed) =>
        checkUninstallable(appPath, { appDirs: [apps], uid, readBundleId, confirmed }),
      listRunningApps: () => Promise.resolve(running),
      moveToTrash: async (target) => {
        moved.push(target);
        await rm(target, { recursive: true, force: true });
      },
      journal: { record: (entry) => Promise.resolve(void journal.push(entry)) },
      now: () => 0,
    };
    return deps;
  }

  const outil = () => path.join(apps, 'Outil.app');

  it('met l’app et les restes choisis à la Corbeille', async () => {
    const deps = await setup();
    const report = await uninstallApp(
      outil(),
      { confirmName: 'Outil', leftovers: [lib('Caches/com.acme.outil')], dryRun: false },
      deps,
    );
    expect(report.failed).toEqual([]);
    expect(moved).toEqual([outil(), lib('Caches/com.acme.outil')]);
    expect(report.moved.every((item) => item.categoryId === 'uninstaller')).toBe(true);
    expect(report.bytesFreed).toBe(110);
    expect(await exists(lib('Application Support/Outil'))).toBe(true);
    expect(journal).toHaveLength(2);
  });

  it('ne déplace rien en mode simulation', async () => {
    const deps = await setup();
    const report = await uninstallApp(
      outil(),
      { confirmName: 'Outil', leftovers: [lib('Caches/com.acme.outil')], dryRun: true },
      deps,
    );
    expect(report.moved).toHaveLength(2);
    expect(moved).toEqual([]);
    expect(await exists(outil())).toBe(true);
  });

  it('refuse sans le nom exact de l’app', async () => {
    const deps = await setup();
    const report = await uninstallApp(
      outil(),
      { confirmName: 'outil', leftovers: [], dryRun: false },
      deps,
    );
    expect(report.failed.map((f) => f.reason)).toEqual(['not-confirmed']);
    expect(moved).toEqual([]);
  });

  it('refuse une app ouverte', async () => {
    const deps = await setup([{ name: 'Outil', bundleId: 'com.acme.outil' }]);
    const report = await uninstallApp(
      outil(),
      { confirmName: 'Outil', leftovers: [], dryRun: false },
      deps,
    );
    expect(report.failed.map((f) => f.reason)).toEqual(['app-open']);
    expect(moved).toEqual([]);
  });

  it('refuse quand les apps ouvertes ne peuvent pas être listées', async () => {
    const deps = await setup();
    deps.listRunningApps = () => Promise.reject(new Error('lsappinfo'));
    const report = await uninstallApp(
      outil(),
      { confirmName: 'Outil', leftovers: [], dryRun: false },
      deps,
    );
    expect(report.failed.map((f) => f.reason)).toEqual(['app-check-failed']);
  });

  it('refuse une app absente de la dernière liste', async () => {
    const deps = await setup();
    const report = await uninstallApp(
      path.join(apps, 'Dossier/Imbriquee.app'),
      { confirmName: 'Imbriquee', leftovers: [], dryRun: false },
      deps,
    );
    expect(report.failed.map((f) => f.reason)).toEqual(['not-scanned']);
    expect(moved).toEqual([]);
  });

  it('refuse un reste qui n’appartient pas à cette app', async () => {
    const deps = await setup();
    const report = await uninstallApp(
      outil(),
      {
        confirmName: 'Outil',
        leftovers: [lib('Caches/com.acme.outilplus'), path.join(home, 'Documents')],
        dryRun: false,
      },
      deps,
    );
    expect(report.failed.map((f) => f.reason)).toEqual(['not-scanned', 'not-scanned']);
    expect(moved).toEqual([outil()]);
    expect(await exists(lib('Caches/com.acme.outilplus'))).toBe(true);
  });

  it('ne touche pas aux restes si l’app n’a pas pu aller à la Corbeille', async () => {
    const deps = await setup();
    deps.moveToTrash = () => Promise.reject(new Error('verrouillé'));
    const report = await uninstallApp(
      outil(),
      { confirmName: 'Outil', leftovers: [lib('Caches/com.acme.outil')], dryRun: false },
      deps,
    );
    expect(report.failed.map((f) => f.reason)).toEqual(['trash-failed']);
    expect(report.moved).toEqual([]);
    expect(await exists(lib('Caches/com.acme.outil'))).toBe(true);
  });
});
