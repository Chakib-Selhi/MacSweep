import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { browsablePath, exploreTrashRefusal } from '../../src/main/safety/guard';
import { pickDiskRoot } from '../../src/main/safety/root';

const home = '/Users/quelquun';

describe('browsablePath', () => {
  it.each([
    ['/', '/Library/Caches'],
    ['/', '/'],
    [home, home],
    [home, `${home}/Movies/film.mp4`],
  ])('accepte un chemin sous la racine explorée (%s) : %s', (base, input) => {
    expect(browsablePath(input, base)).toEqual({ ok: true, path: input });
  });

  it.each([
    [home, '/Users'],
    [home, '/Users/quelquun2/a'],
    [home, `${home}/../autre`],
    [home, `${home}/./a`],
    [home, 'relatif/a'],
    [home, ''],
    [home, 42],
    [home, `${home}/a\0b`],
  ])('refuse %s → %s', (base, input) => {
    expect(browsablePath(input, base).ok).toBe(false);
  });
});

describe('exploreTrashRefusal', () => {
  const roots = [home];

  it.each([`${home}/Movies/film.mp4`, `${home}/Downloads/archives`, `${home}/Projets/site/build`])(
    'laisse aller à la Corbeille %s',
    (target) => {
      expect(exploreTrashRefusal(target, roots)).toBeNull();
    },
  );

  it('demande la confirmation pour Documents, Bureau et Images', () => {
    expect(exploreTrashRefusal(`${home}/Documents/vieux.zip`, roots)).toBe('protected');
    expect(
      exploreTrashRefusal(`${home}/Documents/vieux.zip`, roots, { confirmProtected: true }),
    ).toBeNull();
  });

  it.each([
    ['/Library/Caches/x', 'forbidden'],
    ['/private/var/log/system.log', 'outside-root'],
    ['/Users/autre/Movies/film.mp4', 'outside-root'],
    [home, 'is-root'],
    [`${home}/Library`, 'forbidden'],
    [`${home}/Library/Caches/com.app`, 'read-only'],
    [`${home}/library/caches/com.app`, 'read-only'],
    [`${home}/.config/outil`, 'read-only'],
    [`${home}/Projets/.cache/a`, 'read-only'],
    [`${home}/Applications/Outil.app`, 'read-only'],
    [`${home}/Applications/Outil.app/Contents/MacOS/outil`, 'read-only'],
    [`${home}/Projets/depot/.git`, 'git'],
    [`${home}/.Trash/vieux`, 'trash'],
    [`${home}/Documents`, 'forbidden'],
  ])('refuse %s (%s)', (target, reason) => {
    expect(exploreTrashRefusal(target, roots, { confirmProtected: true })).toBe(reason);
  });
});

describe('pickDiskRoot', () => {
  let base: string;

  beforeAll(async () => {
    base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'macsweep-disk-')));
    await mkdir(path.join(base, 'home'));
  });

  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('explore tout le disque dans l’app', async () => {
    expect(await pickDiskRoot({ root: home, tmpdir: os.tmpdir(), testMode: false })).toBe('/');
  });

  it('remplace le disque par le dossier parent de la racine de test', async () => {
    const root = path.join(base, 'home');
    expect(await pickDiskRoot({ root, tmpdir: os.tmpdir(), testMode: true })).toBe(base);
  });

  it('ne remonte jamais jusqu’au dossier temporaire lui-même', async () => {
    expect(await pickDiskRoot({ root: base, tmpdir: os.tmpdir(), testMode: true })).toBe(base);
  });
});
