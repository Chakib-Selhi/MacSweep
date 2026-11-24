import { mkdir, mkdtemp, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createJournal } from '../../src/main/journal';
import { emptyTrash } from '../../src/main/trash-empty';

let root: string;
let outside: string;
let logsDir: string;
const at = (...parts: string[]) => path.join(root, ...parts);

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'macsweep-trash-')));
  outside = await realpath(await mkdtemp(path.join(os.tmpdir(), 'macsweep-trash-outside-')));
  logsDir = path.join(root, 'logs');
  await mkdir(at('.Trash/dossier'), { recursive: true });
  await writeFile(at('.Trash/fichier.txt'), Buffer.alloc(5000, 1));
  await writeFile(at('.Trash/dossier/dedans.txt'), Buffer.alloc(5000, 1));
  await writeFile(path.join(outside, 'precieux.txt'), 'ne pas toucher');
  await symlink(outside, at('.Trash/lien-vers-dehors'));
  await writeFile(at('a-garder.txt'), 'hors corbeille');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

const run = (confirmation: string, dryRun: boolean) =>
  emptyTrash({ root, confirmation, dryRun, journal: createJournal(logsDir) });

describe('emptyTrash', () => {
  it.each(['', 'vider', 'VIDER ', 'OK', 'oui'])(
    'exige le mot « VIDER » exact (pas %j)',
    async (word) => {
      await expect(run(word, false)).rejects.toThrow();
      expect(await readdir(at('.Trash'))).toHaveLength(3);
    },
  );

  it('en simulation, compte sans rien supprimer', async () => {
    const report = await run('VIDER', true);
    expect(report).toMatchObject({ dryRun: true, deletedCount: 3, failed: [] });
    expect(report.bytesFreed).toBeGreaterThan(10_000);
    expect(await readdir(at('.Trash'))).toHaveLength(3);
    expect(await exists(logsDir)).toBe(false);
  });

  it('vide la Corbeille sans suivre les liens ni toucher au reste', async () => {
    const report = await run('VIDER', false);
    expect(report).toMatchObject({ dryRun: false, deletedCount: 3, failed: [] });
    expect(await readdir(at('.Trash'))).toEqual([]);
    expect(await exists(path.join(outside, 'precieux.txt'))).toBe(true);
    expect(await exists(at('a-garder.txt'))).toBe(true);
    expect(await readdir(logsDir)).toHaveLength(1);
  });

  it('ne fait rien sans Corbeille', async () => {
    await rm(at('.Trash'), { recursive: true });
    expect(await run('VIDER', false)).toMatchObject({ deletedCount: 0, bytesFreed: 0, failed: [] });
  });

  it('refuse une Corbeille qui est un lien symbolique', async () => {
    await rm(at('.Trash'), { recursive: true });
    await symlink(outside, at('.Trash'));
    await expect(run('VIDER', false)).rejects.toThrow();
    expect(await exists(path.join(outside, 'precieux.txt'))).toBe(true);
  });
});
