import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CategoryId } from '../../src/shared/categories';
import type { CleanProgress, ScanDone } from '../../src/shared/types';
import { cleanPaths, type CleanDeps } from '../../src/main/cleaner';
import { createJournal } from '../../src/main/journal';
import type { RunningApp } from '../../src/main/running-apps';
import { createGuard } from '../../src/main/safety/guard';
import { ScanRegistry } from '../../src/main/scan-registry';

let root: string;
let logsDir: string;
const at = (...parts: string[]) => path.join(root, ...parts);

async function file(relative: string, bytes = 1000): Promise<void> {
  await mkdir(path.dirname(at(relative)), { recursive: true });
  await writeFile(at(relative), Buffer.alloc(bytes, 1));
}

async function exists(p: string): Promise<boolean> {
  return stat(p).then(
    () => true,
    () => false,
  );
}

function scanOf(items: { path: string; categoryId: CategoryId; sizeBytes: number }[]): ScanDone {
  const byCategory = new Map<CategoryId, ScanDone['categories'][number]>();
  for (const item of items) {
    const category = byCategory.get(item.categoryId) ?? {
      id: item.categoryId,
      items: [],
      totalBytes: 0,
      filesVisited: 0,
    };
    category.items.push({
      path: item.path,
      sizeBytes: item.sizeBytes,
      modifiedMs: 0,
      isDirectory: true,
    });
    category.totalBytes += item.sizeBytes;
    byCategory.set(item.categoryId, category);
  }
  return {
    scanId: 's',
    status: 'completed',
    root,
    categories: [...byCategory.values()],
    deniedCount: 0,
    deniedDirs: [],
    durationMs: 1,
  };
}

interface Harness {
  deps: CleanDeps;
  trashed: string[];
  progress: CleanProgress[];
}

async function harness(
  overrides: Partial<CleanDeps> = {},
  apps: RunningApp[] | Error = [],
): Promise<Harness> {
  const trashed: string[] = [];
  const progress: CleanProgress[] = [];
  const registry = new ScanRegistry();
  registry.replace(
    scanOf([
      { path: at('Library/Caches/com.a'), categoryId: 'user-caches', sizeBytes: 3000 },
      { path: at('Library/Caches/com.b'), categoryId: 'user-caches', sizeBytes: 2000 },
      { path: at('Library/Caches/com.google.Chrome'), categoryId: 'user-caches', sizeBytes: 500 },
      { path: at('.npm/_cacache'), categoryId: 'js-package-caches', sizeBytes: 700 },
      { path: at('.Trash/vieux.txt'), categoryId: 'trash', sizeBytes: 10 },
      { path: at('Library/Keychains'), categoryId: 'user-caches', sizeBytes: 10 },
    ]),
  );
  const deps: CleanDeps = {
    guard: await createGuard({ root }),
    registry,
    moveToTrash: (p) => {
      trashed.push(p);
      return Promise.resolve();
    },
    listRunningApps: () => (apps instanceof Error ? Promise.reject(apps) : Promise.resolve(apps)),
    journal: createJournal(logsDir),
    onProgress: (p) => progress.push(p),
    now: () => Date.now(),
    ...overrides,
  };
  return { deps, trashed, progress };
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'macsweep-clean-')));
  logsDir = path.join(root, 'userdata-logs');
  await file('Library/Caches/com.a/data');
  await file('Library/Caches/com.b/data');
  await file('Library/Caches/com.google.Chrome/data');
  await file('Library/Caches/pas-scanne/data');
  await file('.npm/_cacache/index');
  await file('.Trash/vieux.txt');
  await file('Library/Keychains/login.keychain-db');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('cleanPaths : mode simulation', () => {
  it('ne déplace aucun fichier et n’écrit rien dans le journal', async () => {
    const { deps, trashed } = await harness();
    const report = await cleanPaths(
      [at('Library/Caches/com.a'), at('Library/Caches/com.b')],
      true,
      deps,
    );
    expect(report.dryRun).toBe(true);
    expect(report.moved.map((m) => m.path)).toEqual([
      at('Library/Caches/com.a'),
      at('Library/Caches/com.b'),
    ]);
    expect(report.bytesFreed).toBe(5000);
    expect(trashed).toEqual([]);
    expect(await exists(at('Library/Caches/com.a/data'))).toBe(true);
    expect(await exists(logsDir)).toBe(false);
  });
});

describe('cleanPaths : nettoyage réel', () => {
  it('met à la Corbeille les chemins validés, avec la taille connue du scan', async () => {
    const { deps, trashed } = await harness();
    const report = await cleanPaths([at('Library/Caches/com.a'), at('.npm/_cacache')], false, deps);
    expect(trashed).toEqual([at('Library/Caches/com.a'), at('.npm/_cacache')]);
    expect(report.bytesFreed).toBe(3700);
    expect(report.failed).toEqual([]);
  });

  it('écrit chaque déplacement dans le journal (chemin, taille, date)', async () => {
    const { deps } = await harness();
    await cleanPaths([at('Library/Caches/com.a')], false, deps);
    const [name] = await readdir(logsDir);
    expect(name).toMatch(/^macsweep-\d{4}-\d{2}-\d{2}\.jsonl$/);
    const content = await readFile(path.join(logsDir, name as string), 'utf8');
    const line = JSON.parse(content.trim()) as Record<string, unknown>;
    expect(line).toMatchObject({
      action: 'trash',
      path: at('Library/Caches/com.a'),
      sizeBytes: 3000,
    });
    expect(new Date(line.date as string).getTime()).not.toBeNaN();
  });

  it('oublie un élément nettoyé : un second appel le refuse', async () => {
    const { deps } = await harness();
    await cleanPaths([at('Library/Caches/com.a')], false, deps);
    const again = await cleanPaths([at('Library/Caches/com.a')], false, deps);
    expect(again.failed).toEqual([{ path: at('Library/Caches/com.a'), reason: 'not-scanned' }]);
  });

  it('saute un échec de la Corbeille, le liste et continue', async () => {
    const { deps, trashed } = await harness({
      moveToTrash: (p) => {
        if (p.endsWith('com.a')) return Promise.reject(new Error('fichier verrouillé'));
        trashed.push(p);
        return Promise.resolve();
      },
    });
    const report = await cleanPaths(
      [at('Library/Caches/com.a'), at('Library/Caches/com.b')],
      false,
      deps,
    );
    expect(report.failed).toEqual([
      { path: at('Library/Caches/com.a'), reason: 'trash-failed', message: 'fichier verrouillé' },
    ]);
    expect(report.moved.map((m) => m.path)).toEqual([at('Library/Caches/com.b')]);
    expect(report.bytesFreed).toBe(2000);
  });

  it('envoie la progression jusqu’au dernier élément', async () => {
    const { deps, progress } = await harness();
    await cleanPaths([at('Library/Caches/com.a'), at('Library/Caches/com.b')], false, deps);
    expect(progress.at(-1)).toMatchObject({ done: 2, total: 2 });
  });
});

describe('cleanPaths : refus (appel IPC forgé)', () => {
  it('refuse ce qui n’a pas été trouvé par le dernier scan', async () => {
    const { deps, trashed } = await harness();
    const report = await cleanPaths([at('Library/Caches/pas-scanne')], false, deps);
    expect(report.failed).toEqual([
      { path: at('Library/Caches/pas-scanne'), reason: 'not-scanned' },
    ]);
    expect(trashed).toEqual([]);
  });

  it('refuse la liste noire même si un scan l’avait listée', async () => {
    const { deps, trashed } = await harness();
    const report = await cleanPaths([at('Library/Keychains')], false, deps);
    expect(report.failed).toEqual([{ path: at('Library/Keychains'), reason: 'forbidden' }]);
    expect(trashed).toEqual([]);
  });

  it('refuse la Corbeille, les entrées invalides et les chemins hors racine', async () => {
    const { deps, trashed } = await harness();
    const report = await cleanPaths(
      [at('.Trash/vieux.txt'), '/etc/hosts', '../../etc', 42, null, '/System'],
      false,
      deps,
    );
    expect(report.failed.map((f) => f.reason)).toEqual([
      'trash',
      'outside-root',
      'invalid-input',
      'invalid-input',
      'invalid-input',
      'forbidden',
    ]);
    expect(report.moved).toEqual([]);
    expect(trashed).toEqual([]);
  });

  it('rejette en bloc une liste qui n’est pas un tableau', async () => {
    const { deps } = await harness();
    await expect(cleanPaths('/tmp', false, deps)).rejects.toThrow();
  });

  it('ne traite qu’une fois un chemin répété', async () => {
    const { deps, trashed } = await harness();
    const a = at('Library/Caches/com.a');
    const report = await cleanPaths([a, a], false, deps);
    expect(trashed).toEqual([a]);
    expect(report.bytesFreed).toBe(3000);
  });
});

describe('cleanPaths : apps ouvertes (règle 6, revérifiée au nettoyage)', () => {
  it('refuse le cache d’une app ouverte', async () => {
    const { deps, trashed } = await harness({}, [
      { name: 'Google Chrome', bundleId: 'com.google.Chrome' },
    ]);
    const report = await cleanPaths(
      [at('Library/Caches/com.google.Chrome'), at('Library/Caches/com.a')],
      false,
      deps,
    );
    expect(report.failed).toEqual([
      { path: at('Library/Caches/com.google.Chrome'), reason: 'app-open' },
    ]);
    expect(trashed).toEqual([at('Library/Caches/com.a')]);
  });

  it('sans liste des apps, refuse les catégories liées à une app mais pas les autres', async () => {
    const { deps, trashed } = await harness({}, new Error('lsappinfo absent'));
    const report = await cleanPaths([at('Library/Caches/com.a'), at('.npm/_cacache')], false, deps);
    expect(report.failed).toEqual([
      { path: at('Library/Caches/com.a'), reason: 'app-check-failed' },
    ]);
    expect(trashed).toEqual([at('.npm/_cacache')]);
  });
});
