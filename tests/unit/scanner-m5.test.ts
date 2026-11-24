import { link, mkdir, mkdtemp, realpath, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CATEGORY_IDS } from '../../src/shared/categories';
import type { ScanDone } from '../../src/shared/types';
import { fileKind, isPackage, TopFiles } from '../../src/main/scanner/large-files';
import { runScan, type ScanConfig } from '../../src/main/scanner/scan';
import type { ToolDeps } from '../../src/main/scanner/tools';

let home: string;
const at = (...parts: string[]) => path.join(home, ...parts);
const DAY = 24 * 60 * 60 * 1000;

async function file(relative: string, content: Buffer | number, ageDays = 0): Promise<void> {
  await mkdir(path.dirname(at(relative)), { recursive: true });
  await writeFile(at(relative), typeof content === 'number' ? Buffer.alloc(content, 7) : content);
  if (ageDays > 0) {
    const date = new Date(Date.now() - ageDays * DAY);
    await utimes(at(relative), date, date);
  }
}

const noTools: ToolDeps = {
  run: () => Promise.reject(new Error('aucun outil')),
  findExecutable: () => Promise.resolve(null),
};

function config(overrides: Partial<ScanConfig> = {}): ScanConfig {
  return {
    scanId: 'm5',
    home,
    categories: CATEGORY_IDS,
    projectDirs: [],
    exclusions: [at('exclu')],
    nodeModulesMinAgeDays: 30,
    downloadsMinAgeDays: 14,
    largeFileThresholdBytes: 120_000,
    duplicateDirs: [at('Documents'), at('Downloads')],
    duplicateMinBytes: 50_000,
    ...overrides,
  };
}

const scan = (overrides: Partial<ScanConfig> = {}, stop: () => boolean = () => false) =>
  runScan(config(overrides), noTools, {
    emitProgress: () => undefined,
    shouldStop: stop,
    now: () => Date.now(),
  });

const paths = (done: ScanDone, id: string) =>
  done.categories
    .find((c) => c.id === id)
    ?.items.map((i) => i.path)
    .sort() ?? [];

/** 100 KB whose first 64 KB are `head` and the rest `tail`. */
function content(head: number, tail: number): Buffer {
  return Buffer.concat([Buffer.alloc(64 * 1024, head), Buffer.alloc(36 * 1024, tail)]);
}

let done: ScanDone;

beforeAll(async () => {
  home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'macsweep-m5-')));

  await file('Library/Caches/Google/Chrome/data', 4096);
  await file('Library/Caches/com.a/x', 4096);
  await file('Library/Caches/com.a/enorme.bin', 500_000);
  await file('Library/Caches/pip/http/x', 4096);
  await file('.cargo/registry/cache/x', 4096);
  await file('.cache/gros', 500_000);
  await file('Library/Developer/Xcode/UserData/Previews/Simulator Devices/x', 4096);
  await file('Library/iTunes/iPhone Software Updates/iPhone_17.ipsw', 4096);
  await file('Library/Application Support/MobileSync/Backup/ABC123/Manifest.db', 4096);
  await file('Library/Containers/com.apple.mail/Data/Library/Mail Downloads/123/doc.pdf', 4096);
  await file('Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw', 4096);

  await file('Movies/film.mp4', 300_000);
  await file('Downloads/image.dmg', 150_000);
  await file('Documents/gros.zip', 200_000);
  await file('Documents/petit.txt', 1000);
  await file('Pictures/Photos Library.photoslibrary/originals/IMG.heic', 500_000);
  await file('exclu/enorme.bin', 500_000);

  await file('Documents/a.bin', content(1, 2), 10);
  await file('Downloads/a-copie.bin', content(1, 2), 5);
  await file('Downloads/a-encore.bin', content(1, 2), 1);
  await file('Documents/b.bin', content(3, 2));
  await file('Documents/c1.bin', content(4, 5));
  await file('Documents/c2.bin', content(4, 6));
  await link(at('Documents/a.bin'), at('Documents/lien-dur.bin'));
  await file('Documents/petit1.bin', 10_000);
  await file('Documents/petit2.bin', 10_000);
  await file('Documents/.cache/a.bin', content(1, 2));

  done = await scan();
});

afterAll(async () => {
  await rm(home, { recursive: true, force: true });
});

describe('nouvelles catégories (D28)', () => {
  it('trouve chaque catégorie à son emplacement', () => {
    expect(paths(done, 'browser-caches')).toEqual([at('Library/Caches/Google')]);
    expect(paths(done, 'dev-caches')).toEqual(
      [at('.cache'), at('.cargo/registry'), at('Library/Caches/pip')].sort(),
    );
    expect(paths(done, 'xcode-caches')).toEqual([at('Library/Developer/Xcode/UserData/Previews')]);
    expect(paths(done, 'ios-updates')).toEqual([
      at('Library/iTunes/iPhone Software Updates/iPhone_17.ipsw'),
    ]);
    expect(paths(done, 'ios-backups')).toEqual([
      at('Library/Application Support/MobileSync/Backup/ABC123'),
    ]);
    expect(paths(done, 'mail-downloads')).toEqual([
      at('Library/Containers/com.apple.mail/Data/Library/Mail Downloads/123'),
    ]);
    expect(paths(done, 'docker-data')).toEqual([
      at('Library/Containers/com.docker.docker/Data/vms'),
    ]);
  });

  it('ne compte pas deux fois les caches de navigateur et pip dans les caches utilisateur', () => {
    expect(paths(done, 'user-caches')).toEqual([at('Library/Caches/com.a')]);
  });
});

describe('gros fichiers (F5)', () => {
  it('liste les fichiers au-dessus du seuil, du plus gros au plus petit, avec leur type', () => {
    const large = done.categories.find((c) => c.id === 'large-files');
    expect(large?.items.map((i) => [path.relative(home, i.path), i.fileKind])).toEqual([
      ['Movies/film.mp4', 'video'],
      ['Documents/gros.zip', 'archive'],
      ['Downloads/image.dmg', 'disk-image'],
    ]);
  });

  it('ignore ~/Library, les dossiers cachés, les paquets et les exclusions', () => {
    const large = paths(done, 'large-files').join('\n');
    expect(large).not.toContain('Library/Caches');
    expect(large).not.toContain('.cache');
    expect(large).not.toContain('photoslibrary');
    expect(large).not.toContain('exclu');
  });

  it('marque les fichiers des dossiers protégés', () => {
    const large = done.categories.find((c) => c.id === 'large-files');
    const zip = large?.items.find((i) => i.path.endsWith('gros.zip'));
    const film = large?.items.find((i) => i.path.endsWith('film.mp4'));
    expect(zip?.protected).toBe(true);
    expect(film?.protected).toBeUndefined();
  });

  it('respecte le seuil réglé', async () => {
    const higher = await scan({ largeFileThresholdBytes: 250_000, duplicateDirs: [] });
    expect(paths(higher, 'large-files')).toEqual([at('Movies/film.mp4')]);
  });
});

describe('doublons (F6)', () => {
  it('regroupe les fichiers identiques, le plus ancien en premier', () => {
    expect(done.duplicateGroups).toHaveLength(1);
    const [group] = done.duplicateGroups;
    expect(group?.files.map((f) => path.relative(home, f.path))).toEqual([
      'Documents/a.bin',
      'Downloads/a-copie.bin',
      'Downloads/a-encore.bin',
    ]);
    expect(group?.files.every((f) => f.groupId === group.id)).toBe(true);
  });

  it('ne confond ni même taille, ni même début, ni lien dur, ni petits fichiers, ni dossiers cachés', () => {
    const all = done.duplicateGroups.flatMap((g) => g.files.map((f) => f.path)).join('\n');
    for (const name of ['b.bin', 'c1.bin', 'c2.bin', 'lien-dur.bin', 'petit1.bin', '.cache']) {
      expect(all).not.toContain(name);
    }
  });

  it('compte comme récupérable tout sauf l’original', async () => {
    const original = await stat(at('Documents/a.bin'));
    const category = done.categories.find((c) => c.id === 'duplicates');
    expect(category?.totalBytes).toBe(2 * original.blocks * 512);
    expect(category?.items).toHaveLength(3);
  });

  it('masque les doublons sans dossier choisi', async () => {
    const none = await scan({ duplicateDirs: [] });
    expect(none.categories.find((c) => c.id === 'duplicates')).toBeUndefined();
    expect(none.duplicateGroups).toEqual([]);
  });

  it('ignore un dossier choisi hors de la racine', async () => {
    const outside = await scan({ duplicateDirs: [os.tmpdir()] });
    expect(outside.categories.find((c) => c.id === 'duplicates')).toBeUndefined();
  });

  it('s’arrête à l’annulation', async () => {
    let calls = 0;
    const cancelled = await scan({}, () => ++calls > 50);
    expect(cancelled.status).toBe('cancelled');
  });
});

describe('outils des gros fichiers', () => {
  it.each([
    ['vacances.MOV', 'video'],
    ['macOS.iso', 'disk-image'],
    ['sauvegarde.tar.gz', 'archive'],
    ['notes.txt', 'other'],
  ])('%s est de type %s', (name, kind) => {
    expect(fileKind(name)).toBe(kind);
  });

  it('reconnaît les paquets macOS', () => {
    expect(isPackage('Photos Library.photoslibrary')).toBe(true);
    expect(isPackage('Xcode.app')).toBe(true);
    expect(isPackage('dossier')).toBe(false);
  });

  it('TopFiles garde les plus gros, triés', () => {
    const top = new TopFiles(3);
    for (const size of [5, 1, 9, 3, 7, 2, 8]) {
      top.add({ path: `/f${size}`, sizeBytes: size, modifiedMs: 0 });
    }
    expect(top.result().map((f) => f.sizeBytes)).toEqual([9, 8, 7]);
  });
});
