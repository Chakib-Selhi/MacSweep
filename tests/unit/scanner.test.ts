import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CATEGORY_IDS } from '../../src/shared/categories';
import type { ScanDone, ScanProgress } from '../../src/shared/types';
import { parseUnavailableSimulators } from '../../src/main/scanner/categories';
import { runScan, type ScanConfig } from '../../src/main/scanner/scan';
import type { ToolDeps } from '../../src/main/scanner/tools';

const UNAVAILABLE = '11111111-2222-3333-4444-555555555555';
const AVAILABLE = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';
const DAY = 24 * 60 * 60 * 1000;

let home: string;
let outside: string;
const at = (...parts: string[]) => path.join(home, ...parts);

async function file(relative: string, bytes = 4096): Promise<void> {
  await mkdir(path.dirname(at(relative)), { recursive: true });
  await writeFile(at(relative), Buffer.alloc(bytes, 1));
}

/** Sets the modification date of a file or of a whole tree. */
async function age(relative: string, days: number): Promise<void> {
  const date = new Date(Date.now() - days * DAY);
  const walk = async (p: string): Promise<void> => {
    const stats = await lstat(p);
    if (stats.isDirectory()) {
      for (const name of await readdir(p)) await walk(path.join(p, name));
    }
    await utimes(p, date, date);
  };
  await walk(at(relative));
}

function tools(overrides: Partial<ToolDeps> = {}): ToolDeps {
  return {
    findExecutable: () => Promise.resolve('/opt/homebrew/bin/brew'),
    run: (file, args) => {
      if (file.endsWith('xcode-select'))
        return Promise.resolve('/Applications/Xcode.app/Contents/Developer\n');
      if (file.endsWith('xcrun')) {
        return Promise.resolve(
          JSON.stringify({
            devices: {
              'com.apple.CoreSimulator.SimRuntime.iOS-17-0': [
                { udid: UNAVAILABLE, isAvailable: false, name: 'iPhone 15' },
                { udid: AVAILABLE, isAvailable: true, name: 'iPhone 16' },
                { udid: '../../etc', isAvailable: false },
              ],
            },
          }),
        );
      }
      if (file.endsWith('brew') && args[0] === '--cache') {
        return Promise.resolve(`${at('Library/Caches/Homebrew')}\n`);
      }
      return Promise.reject(new Error(`outil inattendu : ${file}`));
    },
    ...overrides,
  };
}

function config(overrides: Partial<ScanConfig> = {}): ScanConfig {
  return {
    scanId: 'scan-test',
    home,
    categories: CATEGORY_IDS,
    projectDirs: [at('projets')],
    exclusions: [at('Library/Caches/exclu')],
    nodeModulesMinAgeDays: 30,
    downloadsMinAgeDays: 14,
    largeFileThresholdBytes: 1e12,
    duplicateDirs: [],
    duplicateMinBytes: 1_000_000,
    ...overrides,
  };
}

async function scan(
  overrides: Partial<ScanConfig> = {},
  deps: ToolDeps = tools(),
  shouldStop: () => boolean = () => false,
): Promise<{ done: ScanDone; progress: ScanProgress[] }> {
  const progress: ScanProgress[] = [];
  const done = await runScan(config(overrides), deps, {
    emitProgress: (p) => progress.push(p),
    shouldStop,
    now: () => Date.now(),
  });
  return { done, progress };
}

const category = (done: ScanDone, id: string) => done.categories.find((c) => c.id === id);
const itemPaths = (done: ScanDone, id: string) =>
  category(done, id)
    ?.items.map((i) => i.path)
    .sort() ?? [];

beforeAll(async () => {
  home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'macsweep-scan-')));
  outside = await realpath(await mkdtemp(path.join(os.tmpdir(), 'macsweep-scan-outside-')));
  await writeFile(path.join(outside, 'enorme.bin'), Buffer.alloc(2_000_000, 1));

  await file('Library/Caches/com.a/f1', 16_384);
  await file('Library/Caches/com.a/f2', 16_384);
  await symlink(path.join(outside, 'enorme.bin'), at('Library/Caches/com.a/lien-externe'));
  await file('Library/Caches/com.b/original', 65_536);
  await link(at('Library/Caches/com.b/original'), at('Library/Caches/com.b/lien-dur'));
  await file('Library/Caches/Yarn/paquet');
  await file('Library/Caches/Homebrew/downloads/formule.tar.gz');
  await file('Library/Caches/MacSweep/interne');
  await file('Library/Caches/exclu/ignore');
  await file('Library/Caches/verrou/secret');
  await chmod(at('Library/Caches/verrou'), 0o000);
  await symlink(outside, at('Library/Caches/lien-cache'));
  await file('Library/Logs/app.log');
  await file('Library/Keychains/login.keychain-db');
  await file('Library/Developer/Xcode/DerivedData/Projet-abc/Build/objet.o');
  await file(`Library/Developer/CoreSimulator/Devices/${UNAVAILABLE}/data/x`);
  await file(`Library/Developer/CoreSimulator/Devices/${AVAILABLE}/data/x`);
  await file('.npm/_cacache/index/x');
  await file('Downloads/vieux.dmg');
  await file('Downloads/recent.dmg');
  await file('Downloads/vieux.pdf');
  await file('Downloads/Vieux.PKG/Contents/payload');
  await file('.Trash/ancien.txt');
  await file('projets/app1/node_modules/dep/index.js');
  await file('projets/app1/node_modules/dep/node_modules/sous-dep/index.js');
  await file('projets/app2/node_modules/dep/index.js');
  await file('projets/.cache/node_modules/x/index.js');

  await age('Downloads/vieux.dmg', 30);
  await age('Downloads/vieux.pdf', 30);
  await age('Downloads/Vieux.PKG', 30);
  await age('projets/app1/node_modules', 60);
});

afterAll(async () => {
  await chmod(at('Library/Caches/verrou'), 0o755).catch(() => undefined);
  await rm(home, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe('runScan : catégories', () => {
  it('termine et masque les catégories dont le dossier manque', async () => {
    const { done } = await scan();
    expect(done.status).toBe('completed');
    const ids = done.categories.map((c) => c.id).sort();
    expect(ids).toEqual(
      [
        'downloaded-installers',
        'homebrew-cache',
        'large-files',
        'ios-simulators',
        'js-package-caches',
        'node-modules',
        'trash',
        'user-caches',
        'user-logs',
        'xcode-derived-data',
      ].sort(),
    );
  });

  it('trie les catégories et les éléments du plus gros au plus petit', async () => {
    const { done } = await scan();
    const totals = done.categories.map((c) => c.totalBytes);
    expect(totals).toEqual([...totals].sort((a, b) => b - a));
    for (const c of done.categories) {
      const sizes = c.items.map((i) => i.sizeBytes);
      expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
      expect(c.totalBytes).toBe(sizes.reduce((a, b) => a + b, 0));
    }
  });

  it('ne compte pas deux fois les caches Yarn et Homebrew, ni le cache de MacSweep', async () => {
    const { done } = await scan();
    expect(itemPaths(done, 'user-caches')).toEqual(
      [at('Library/Caches/com.a'), at('Library/Caches/com.b'), at('Library/Caches/verrou')].sort(),
    );
    expect(itemPaths(done, 'js-package-caches')).toEqual(
      [at('.npm/_cacache'), at('Library/Caches/Yarn')].sort(),
    );
    expect(itemPaths(done, 'homebrew-cache')).toEqual([at('Library/Caches/Homebrew/downloads')]);
  });

  it('ne retient que les installeurs anciens (.dmg, .pkg, .zip)', async () => {
    const { done } = await scan();
    expect(itemPaths(done, 'downloaded-installers')).toEqual(
      [at('Downloads/Vieux.PKG'), at('Downloads/vieux.dmg')].sort(),
    );
  });

  it('ne retient que les node_modules anciens, sans descendre dans les dossiers cachés', async () => {
    const { done } = await scan();
    expect(itemPaths(done, 'node-modules')).toEqual([at('projets/app1/node_modules')]);
  });

  it('masque node_modules sans dossier de projets', async () => {
    const { done } = await scan({ projectDirs: [] });
    expect(category(done, 'node-modules')).toBeUndefined();
  });

  it('ne retient que les simulateurs indisponibles, avec un identifiant valide', async () => {
    const { done } = await scan();
    expect(itemPaths(done, 'ios-simulators')).toEqual([
      at(`Library/Developer/CoreSimulator/Devices/${UNAVAILABLE}`),
    ]);
  });

  it('liste la Corbeille', async () => {
    const { done } = await scan();
    expect(itemPaths(done, 'trash')).toEqual([at('.Trash/ancien.txt')]);
  });
});

describe('runScan : sécurité et exactitude', () => {
  it('ne signale jamais rien dans la liste noire ni dans les exclusions', async () => {
    const { done } = await scan();
    const all = done.categories.flatMap((c) => c.items.map((i) => i.path));
    expect(all.some((p) => p.includes('Keychains'))).toBe(false);
    expect(all.some((p) => p.includes('/exclu'))).toBe(false);
    expect(all.some((p) => p.includes('lien-cache'))).toBe(false);
  });

  it('ne suit pas les liens symboliques (le fichier externe de 2 Mo n’est pas compté)', async () => {
    const { done } = await scan();
    const comA = category(done, 'user-caches')?.items.find((i) => i.path.endsWith('com.a'));
    expect(comA?.sizeBytes).toBeGreaterThan(0);
    expect(comA?.sizeBytes).toBeLessThan(1_000_000);
  });

  it('compte une seule fois les liens durs, en blocs alloués comme du', async () => {
    const { done } = await scan();
    const comB = category(done, 'user-caches')?.items.find((i) => i.path.endsWith('com.b'));
    const dir = await lstat(at('Library/Caches/com.b'));
    const original = await lstat(at('Library/Caches/com.b/original'));
    expect(comB?.sizeBytes).toBe((dir.blocks + original.blocks) * 512);
  });

  it('compte et liste les dossiers refusés au lieu de les ignorer', async () => {
    const { done } = await scan();
    expect(done.deniedCount).toBeGreaterThanOrEqual(1);
    expect(done.deniedDirs).toContain(at('Library/Caches/verrou'));
  });

  it('ignore une source qui sort de la racine (brew --cache externe)', async () => {
    const deps = tools();
    const { done } = await scan(
      {},
      {
        ...deps,
        run: (file, args) =>
          file.endsWith('brew') ? Promise.resolve(`${outside}\n`) : deps.run(file, args),
      },
    );
    expect(category(done, 'homebrew-cache')).toBeUndefined();
  });

  it('masque les catégories dont l’outil échoue, sans faire échouer le scan', async () => {
    const { done } = await scan({}, tools({ run: () => Promise.reject(new Error('absent')) }));
    expect(done.status).toBe('completed');
    expect(category(done, 'ios-simulators')).toBeUndefined();
    expect(category(done, 'homebrew-cache')).toBeUndefined();
    expect(category(done, 'user-caches')).toBeDefined();
  });

  it('masque Homebrew quand brew n’est pas installé', async () => {
    const { done } = await scan({}, tools({ findExecutable: () => Promise.resolve(null) }));
    expect(category(done, 'homebrew-cache')).toBeUndefined();
  });
});

describe('runScan : progression et annulation', () => {
  it('envoie la progression avec l’identifiant du scan', async () => {
    const { progress } = await scan();
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.every((p) => p.scanId === 'scan-test')).toBe(true);
    expect(new Set(progress.map((p) => p.categoryId)).size).toBeGreaterThan(1);
  });

  it('s’arrête dès la demande d’annulation et renvoie un résultat partiel', async () => {
    let calls = 0;
    const started = Date.now();
    const { done } = await scan({}, tools(), () => ++calls > 3);
    expect(done.status).toBe('cancelled');
    expect(Date.now() - started).toBeLessThan(1000);
    expect(done.categories.length).toBeLessThan(9);
  });

  it('annulé avant de commencer, ne mesure rien', async () => {
    const { done } = await scan({}, tools(), () => true);
    expect(done.status).toBe('cancelled');
    expect(done.categories).toEqual([]);
  });
});

describe('parseUnavailableSimulators', () => {
  it.each([
    '{}',
    '[]',
    '{"devices":null}',
    '{"devices":{"r":"x"}}',
    '{"devices":{"r":[null,1,"a"]}}',
  ])('résiste à une sortie inattendue : %s', (json) => {
    expect(parseUnavailableSimulators(json)).toEqual([]);
  });
});
