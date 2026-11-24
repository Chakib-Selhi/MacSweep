import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifyPath, createGuard, screenPaths, type Guard } from '../../src/main/safety/guard';

// The fixture plays the role of the home folder: nothing here touches the real one (rule 5).
let rawRoot: string;
let root: string;
let outside: string;
let guard: Guard;

const at = (...parts: string[]) => path.join(rawRoot, ...parts);
const real = (...parts: string[]) => path.join(root, ...parts);

async function file(relative: string, content = 'x'): Promise<void> {
  await mkdir(path.dirname(at(relative)), { recursive: true });
  await writeFile(at(relative), content);
}

beforeAll(async () => {
  rawRoot = await mkdtemp(path.join(os.tmpdir(), 'macsweep-guard-'));
  root = await realpath(rawRoot);
  outside = await realpath(await mkdtemp(path.join(os.tmpdir(), 'macsweep-outside-')));
  await writeFile(path.join(outside, 'secret.txt'), 'secret');

  await file('Library/Caches/com.example.app/cache.db');
  await file('Library/Logs/app.log');
  await file('Library/Keychains/login.keychain-db');
  await file('Library/Mail/V10/mail.emlx');
  await file('Library/Messages/chat.db');
  await file('Library/Photos/lib');
  await file('Library/Mobile Documents/com~apple~CloudDocs/note.txt');
  await file('.ssh/id_ed25519');
  await file('.gnupg/pubring.kbx');
  await file('Documents/rapport.pdf');
  await file('Desktop/capture.png');
  await file('Pictures/photo.jpg');
  await file('.Trash/vieux.txt');
  await file('code/projet/.git/HEAD');
  await file('code/projet/src/index.ts');
  await file('code/lib/package.json');

  await symlink(outside, at('Library/Caches/lien-dossier-externe'));
  await symlink(path.join(outside, 'secret.txt'), at('Library/Caches/lien-fichier-externe'));
  await symlink(at('Library/Caches/com.example.app'), at('Library/Caches/lien-interne'));
  await symlink(at('Library/Keychains'), at('Library/Caches/lien-vers-keychains'));
  await symlink(at('Library/Keychains'), at('alias-keychains'));
  await symlink(at('Library/Caches/disparu'), at('Library/Caches/lien-casse'));
  await symlink(rawRoot, at('Library/Caches/lien-vers-racine'));

  guard = await createGuard({ root: rawRoot });
});

afterAll(async () => {
  await rm(rawRoot, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe('checkTrashable : chemins autorisés', () => {
  it('accepte un dossier de cache et renvoie le chemin réel', async () => {
    const result = await guard.checkTrashable(at('Library/Caches/com.example.app'));
    expect(result).toEqual({ ok: true, path: real('Library/Caches/com.example.app') });
  });

  it('accepte un fichier de log', async () => {
    const result = await guard.checkTrashable(at('Library/Logs/app.log'));
    expect(result.ok).toBe(true);
  });

  it('accepte un sous-dossier de projet qui ne contient pas .git', async () => {
    expect((await guard.checkTrashable(at('code/projet/src'))).ok).toBe(true);
  });

  it('accepte un lien symbolique interne et renvoie le lien, pas sa cible', async () => {
    const result = await guard.checkTrashable(at('Library/Caches/lien-interne'));
    expect(result).toEqual({ ok: true, path: real('Library/Caches/lien-interne') });
  });
});

describe('checkTrashable : entrées invalides (appel IPC forgé)', () => {
  it.each([
    ['un nombre', 42],
    ['null', null],
    ['undefined', undefined],
    ['un objet', { path: '/tmp' }],
    ['un tableau', ['/tmp']],
    ['une chaîne vide', ''],
    ['un chemin relatif', 'Library/Caches'],
    ['un tilde', '~/Library/Caches'],
    ['un octet nul', '/tmp/a\0b'],
    ['un chemin démesuré', `/${'a'.repeat(5000)}`],
  ])('refuse %s', async (_label, input) => {
    const result = await guard.checkTrashable(input);
    expect(result).toMatchObject({ ok: false, reason: 'invalid-input' });
  });
});

describe('checkTrashable : chemins avec ..', () => {
  it.each([
    'Library/Caches/../../.ssh/id_ed25519',
    'Library/Caches/../Caches/com.example.app',
    'Library/./Caches/com.example.app',
  ])('refuse %s même si la destination serait autorisée', async (relative) => {
    const result = await guard.checkTrashable(`${rawRoot}/${relative}`);
    expect(result).toMatchObject({ ok: false, reason: 'invalid-input' });
  });
});

describe('checkTrashable : hors du dossier utilisateur', () => {
  it.each(['/etc/hosts', '/private/etc/hosts', '/tmp', '/Users'])('refuse %s', async (p) => {
    const result = await guard.checkTrashable(p);
    expect(result.ok).toBe(false);
  });

  it('refuse un fichier hors de la racine', async () => {
    const result = await guard.checkTrashable(path.join(outside, 'secret.txt'));
    expect(result).toMatchObject({ ok: false, reason: 'outside-root' });
  });

  it('refuse la racine elle-même, avec ou sans barre finale', async () => {
    expect(await guard.checkTrashable(rawRoot)).toMatchObject({ ok: false, reason: 'is-root' });
    expect(await guard.checkTrashable(`${rawRoot}/`)).toMatchObject({
      ok: false,
      reason: 'is-root',
    });
  });

  it.each([
    '/System/Library',
    '/usr/bin/ls',
    '/bin/sh',
    '/sbin/mount',
    '/Library/Caches',
    '/Applications/Safari.app',
  ])('refuse le chemin système %s', async (p) => {
    expect(await guard.checkTrashable(p)).toMatchObject({ ok: false, reason: 'forbidden' });
  });
});

describe('checkTrashable : liste noire', () => {
  it.each([
    'Library/Keychains/login.keychain-db',
    'Library/Keychains',
    'Library/Mail/V10/mail.emlx',
    'Library/Messages',
    'Library/Photos/lib',
    'Library/Mobile Documents/com~apple~CloudDocs/note.txt',
    '.ssh/id_ed25519',
    '.ssh',
    '.gnupg',
  ])('refuse %s', async (relative) => {
    expect(await guard.checkTrashable(at(relative))).toMatchObject({
      ok: false,
      reason: 'forbidden',
    });
  });

  it('refuse un dossier qui contient un élément de la liste noire (~/Library)', async () => {
    expect(await guard.checkTrashable(at('Library'))).toMatchObject({
      ok: false,
      reason: 'forbidden',
    });
  });

  it.each([
    'library/keychains/login.keychain-db',
    'LIBRARY/KEYCHAINS',
    '.SSH/id_ed25519',
    'Library/MAIL',
  ])('ignore la casse : %s', async (relative) => {
    expect(await guard.checkTrashable(`${rawRoot}/${relative}`)).toMatchObject({
      ok: false,
      reason: 'forbidden',
    });
  });

  it('normalise Unicode : une racine écrite en NFD reconnaît un chemin écrit en NFC', () => {
    const nfdRoot = '/Users/Ame\u0301lie';
    expect(classifyPath('/Users/Am\u00e9lie/.ssh/id', [nfdRoot])).toBe('forbidden');
    expect(classifyPath('/Users/Am\u00e9lie/Library/Caches/x', [nfdRoot])).toBeNull();
  });
});

describe('checkTrashable : dossiers protégés (Documents, Bureau, Images)', () => {
  it.each(['Documents/rapport.pdf', 'Desktop/capture.png', 'Pictures/photo.jpg'])(
    'refuse %s sans confirmation',
    async (relative) => {
      expect(await guard.checkTrashable(at(relative))).toMatchObject({
        ok: false,
        reason: 'protected',
      });
    },
  );

  it('accepte un fichier protégé avec confirmProtected', async () => {
    const result = await guard.checkTrashable(at('Documents/rapport.pdf'), {
      confirmProtected: true,
    });
    expect(result).toEqual({ ok: true, path: real('Documents/rapport.pdf') });
  });

  it.each(['Documents', 'Desktop', 'Pictures'])(
    'refuse toujours le dossier %s lui-même',
    async (relative) => {
      const result = await guard.checkTrashable(at(relative), { confirmProtected: true });
      expect(result).toMatchObject({ ok: false, reason: 'forbidden' });
    },
  );
});

describe('checkTrashable : dépôts git et Corbeille', () => {
  it.each(['code/projet/.git', 'code/projet/.git/HEAD'])('refuse %s', async (relative) => {
    expect(await guard.checkTrashable(at(relative))).toMatchObject({ ok: false, reason: 'git' });
  });

  it('refuse un dossier qui est la racine d’un dépôt git', async () => {
    expect(await guard.checkTrashable(at('code/projet'))).toMatchObject({
      ok: false,
      reason: 'git',
    });
  });

  it.each(['.Trash', '.Trash/vieux.txt'])(
    'refuse %s (vidage seulement via trash:empty)',
    async (relative) => {
      expect(await guard.checkTrashable(at(relative))).toMatchObject({
        ok: false,
        reason: 'trash',
      });
    },
  );
});

describe('checkTrashable : liens symboliques', () => {
  it('refuse un lien vers un dossier hors de la racine', async () => {
    const result = await guard.checkTrashable(at('Library/Caches/lien-dossier-externe'));
    expect(result).toMatchObject({ ok: false, reason: 'outside-root' });
  });

  it('refuse un lien vers un fichier hors de la racine', async () => {
    const result = await guard.checkTrashable(at('Library/Caches/lien-fichier-externe'));
    expect(result).toMatchObject({ ok: false, reason: 'outside-root' });
  });

  it('refuse un fichier atteint à travers un dossier-lien externe', async () => {
    const result = await guard.checkTrashable(at('Library/Caches/lien-dossier-externe/secret.txt'));
    expect(result).toMatchObject({ ok: false, reason: 'outside-root' });
  });

  it('refuse un lien vers la liste noire', async () => {
    const result = await guard.checkTrashable(at('Library/Caches/lien-vers-keychains'));
    expect(result).toMatchObject({ ok: false, reason: 'forbidden' });
  });

  it('refuse un fichier de la liste noire atteint à travers un alias', async () => {
    const result = await guard.checkTrashable(at('alias-keychains/login.keychain-db'));
    expect(result).toMatchObject({ ok: false, reason: 'forbidden' });
  });

  it('refuse un lien vers la racine', async () => {
    const result = await guard.checkTrashable(at('Library/Caches/lien-vers-racine'));
    expect(result).toMatchObject({ ok: false, reason: 'is-root' });
  });

  it('refuse un lien cassé', async () => {
    const result = await guard.checkTrashable(at('Library/Caches/lien-casse'));
    expect(result).toMatchObject({ ok: false, reason: 'broken-symlink' });
  });

  it('refuse un chemin inexistant', async () => {
    const result = await guard.checkTrashable(at('Library/Caches/inexistant'));
    expect(result).toMatchObject({ ok: false, reason: 'not-found' });
  });
});

describe('checkReadable', () => {
  it('accepte un chemin sous la racine, y compris protégé', async () => {
    expect((await guard.checkReadable(at('Documents/rapport.pdf'))).ok).toBe(true);
    expect((await guard.checkReadable(at('Library/Caches'))).ok).toBe(true);
  });

  it('refuse un chemin hors de la racine ou un lien qui en sort', async () => {
    expect((await guard.checkReadable('/etc/hosts')).ok).toBe(false);
    expect((await guard.checkReadable(at('Library/Caches/lien-dossier-externe'))).ok).toBe(false);
  });

  it('refuse une entrée forgée', async () => {
    expect(await guard.checkReadable(42)).toMatchObject({ ok: false, reason: 'invalid-input' });
  });
});

describe('screenPaths : appel IPC clean:execute forgé à la main', () => {
  it('ne laisse passer que les chemins valides', async () => {
    const forged: unknown = [
      '/System',
      '../../etc',
      42,
      null,
      at('Library/Keychains'),
      at('Library/Caches/lien-dossier-externe'),
      at('Library/Logs/app.log'),
    ];
    const result = await screenPaths(guard, forged);
    expect(result.accepted).toEqual([real('Library/Logs/app.log')]);
    expect(result.refused).toHaveLength(6);
  });

  it('dédoublonne les chemins acceptés', async () => {
    const log = at('Library/Logs/app.log');
    const result = await screenPaths(guard, [log, log]);
    expect(result.accepted).toEqual([real('Library/Logs/app.log')]);
  });

  it.each([
    ['une chaîne', '/tmp'],
    ['un objet', { 0: '/tmp' }],
    ['null', null],
  ])('rejette en bloc une liste qui n’est pas un tableau (%s)', async (_label, forged) => {
    await expect(screenPaths(guard, forged)).rejects.toThrow();
  });
});

describe('createGuard', () => {
  it('refuse une racine qui est la racine du disque', async () => {
    await expect(createGuard({ root: '/' })).rejects.toThrow();
  });

  it('refuse une racine qui n’existe pas', async () => {
    await expect(createGuard({ root: '/chemin/inexistant/macsweep' })).rejects.toThrow();
  });
});
