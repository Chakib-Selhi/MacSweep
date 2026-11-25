import { chmod, link, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildExploreTree,
  diskSkipper,
  ExploreTree,
  exploreRegistry,
  type ExploreWalkOptions,
} from '../../src/main/scanner/explore';

// Everything lives in a temporary folder: the real home folder is never read (rule 5).
let root: string;
const at = (...parts: string[]) => path.join(root, ...parts);

async function file(relative: string, bytes: number): Promise<void> {
  await mkdir(path.dirname(at(relative)), { recursive: true });
  await writeFile(at(relative), Buffer.alloc(bytes, 7));
}

function walk(options: Partial<ExploreWalkOptions> = {}) {
  return buildExploreTree({
    rootPath: root,
    skip: () => false,
    shouldStop: () => false,
    onTick: () => undefined,
    ...options,
  });
}

beforeAll(async () => {
  root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'macsweep-explore-')));
  await file('Movies/film.mp4', 400_000);
  await file('Movies/court.mov', 100_000);
  await file('Projets/site/index.html', 8_000);
  for (let i = 0; i < 12; i += 1) await file(`Nombreux/f${i}.txt`, 4_096 * (i + 1));
  await link(at('Movies/film.mp4'), at('Projets/lien-dur.mp4'));
  await symlink('/usr', at('Projets/vers-usr'));
  await file('Ferme/secret.txt', 50_000);
  await chmod(at('Ferme'), 0o000);
  await file('Exclu/gros.bin', 900_000);
});

afterAll(async () => {
  await chmod(at('Ferme'), 0o755);
  await rm(root, { recursive: true, force: true });
});

describe('buildExploreTree', () => {
  it('additionne les tailles des sous-dossiers, comme du', () => {
    const tree = new ExploreTree(walk());
    const movies = tree.get(at('Movies'));
    expect(movies?.isDirectory).toBe(true);
    expect(movies?.sizeBytes).toBeGreaterThanOrEqual(500_000);
    const top = tree.list(root);
    expect(top?.sizeBytes).toBeGreaterThanOrEqual(
      (movies?.sizeBytes ?? 0) + (tree.get(at('Nombreux'))?.sizeBytes ?? 0),
    );
  });

  it('compte un lien dur une seule fois et ne suit jamais un lien symbolique', () => {
    const tree = new ExploreTree(walk());
    const projets = tree.list(at('Projets'));
    const names = projets?.entries.map((entry) => entry.name);
    expect(names).toContain('vers-usr');
    const usr = projets?.entries.find((entry) => entry.name === 'vers-usr');
    expect(usr?.kind).toBe('file');
    expect(tree.get(at('Projets/vers-usr/bin'))).toBeUndefined();
    expect(projets?.sizeBytes ?? Infinity).toBeLessThan(100_000);
  });

  it('trie par taille et regroupe les petits fichiers au-delà de la limite', () => {
    const tree = new ExploreTree(walk({ topFilesPerDir: 5 }));
    const listing = tree.list(at('Nombreux'));
    const entries = listing?.entries ?? [];
    expect(entries.map((entry) => entry.name).slice(0, 5)).toEqual([
      'f11.txt',
      'f10.txt',
      'f9.txt',
      'f8.txt',
      'f7.txt',
    ]);
    const others = entries.find((entry) => entry.kind === 'others');
    expect(others?.fileCount).toBe(7);
    expect(listing?.fileCount).toBe(12);
  });

  it('compte un dossier illisible comme refusé sans échouer', () => {
    const flat = walk();
    expect(flat.deniedCount).toBeGreaterThanOrEqual(1);
    const ferme = new ExploreTree(flat).list(root)?.entries.find((e) => e.name === 'Ferme');
    expect(ferme?.denied).toBe(true);
  });

  it('n’entre pas dans un dossier ignoré', () => {
    const tree = new ExploreTree(walk({ skip: (dir) => dir === at('Exclu') }));
    expect(tree.get(at('Exclu'))).toBeUndefined();
  });

  it('s’arrête quand on l’annule', () => {
    let calls = 0;
    const flat = walk({ shouldStop: () => (calls += 1) > 1 });
    expect(flat.stopped).toBe(true);
  });
});

describe('ExploreTree', () => {
  it('ne connaît que les chemins de l’exploration', () => {
    const tree = new ExploreTree(walk());
    expect(tree.list(at('Inexistant'))).toBeNull();
    expect(tree.list('/usr')).toBeNull();
    expect(tree.get(at('Movies/film.mp4'))?.isDirectory).toBe(false);
  });

  it('retire un élément mis à la Corbeille et met à jour les dossiers parents', () => {
    const tree = new ExploreTree(walk());
    const before = tree.list(at('Movies'))?.sizeBytes ?? 0;
    const film = tree.get(at('Movies/film.mp4'))?.sizeBytes ?? 0;
    tree.forget(at('Movies/film.mp4'));
    expect(tree.get(at('Movies/film.mp4'))).toBeUndefined();
    expect(tree.list(at('Movies'))?.sizeBytes).toBe(before - film);
    expect(tree.list(at('Movies'))?.entries.map((e) => e.name)).toEqual(['court.mov']);
  });

  it('limite le nombre d’éléments renvoyés', () => {
    const tree = new ExploreTree(walk());
    const listing = tree.list(at('Nombreux'), 3);
    expect(listing?.entries).toHaveLength(4);
    expect(listing?.entries[3]).toMatchObject({ kind: 'others', fileCount: 9 });
  });
});

describe('diskSkipper', () => {
  it('saute les volumes en double et les montages quand on explore /', () => {
    const skip = diskSkipper('/', []);
    for (const dir of ['/System/Volumes', '/Volumes', '/dev', '/net', '/home']) {
      expect(skip(dir)).toBe(true);
    }
    expect(skip('/System')).toBe(false);
    expect(skip('/Users')).toBe(false);
  });

  it('saute les exclusions de l’utilisateur', () => {
    const skip = diskSkipper('/Users/quelquun', ['/Users/quelquun/Archives']);
    expect(skip('/Users/quelquun/Archives')).toBe(true);
    expect(skip('/Users/quelquun/Archives/2020')).toBe(true);
    expect(skip('/Users/quelquun/Volumes')).toBe(false);
  });
});

describe('exploreRegistry', () => {
  it('ne propose que ce que la carte montre, sans la racine ni un dossier illisible', () => {
    const tree = new ExploreTree(walk());
    const registry = exploreRegistry(tree);
    expect(registry.get(at('Movies'))).toMatchObject({ categoryId: 'explorer' });
    expect(registry.get(root)).toBeUndefined();
    expect(registry.get(at('Ferme'))).toBeUndefined();
    expect(registry.get(at('Inconnu'))).toBeUndefined();
    registry.forget(at('Movies'));
    expect(registry.get(at('Movies'))).toBeUndefined();
  });
});
