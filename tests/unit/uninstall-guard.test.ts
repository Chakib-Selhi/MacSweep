import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkUninstallable, type UninstallContext } from '../../src/main/safety/guard';

// A fake /Applications in the temporary folder: no real app is ever touched (rule 5).
let base: string;
let apps: string;
let userApps: string;
const uid = process.getuid?.() ?? 501;

const bundleIds: Record<string, string> = {
  'Outil.app': 'com.acme.outil',
  'Notes.app': 'com.apple.Notes',
  'Boutique.app': 'com.acme.boutique',
  'Perso.app': 'com.acme.perso',
};

function context(over: Partial<UninstallContext> = {}): UninstallContext {
  return {
    appDirs: [apps, userApps],
    uid,
    confirmed: true,
    readBundleId: (appPath) => Promise.resolve(bundleIds[path.basename(appPath)] ?? null),
    ...over,
  };
}

async function bundle(dir: string, name: string): Promise<void> {
  await mkdir(path.join(dir, name, 'Contents/MacOS'), { recursive: true });
}

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'macsweep-uninstall-')));
  apps = path.join(base, 'Applications');
  userApps = path.join(base, 'home/Applications');
  await bundle(apps, 'Outil.app');
  await bundle(apps, 'Notes.app');
  await bundle(apps, 'Boutique.app');
  await mkdir(path.join(apps, 'Boutique.app/Contents/_MASReceipt'), { recursive: true });
  await writeFile(path.join(apps, 'Boutique.app/Contents/_MASReceipt/receipt'), 'x');
  await bundle(apps, 'Utilitaires/Sous.app');
  await bundle(apps, 'SansId.app');
  await writeFile(path.join(apps, 'Fichier.app'), 'pas un dossier');
  await bundle(base, 'Ailleurs/Cible.app');
  await symlink(path.join(base, 'Ailleurs/Cible.app'), path.join(apps, 'Lien.app'));
  await bundle(userApps, 'Perso.app');
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('checkUninstallable', () => {
  it('accepte une app à soi, directement dans Applications', async () => {
    const target = path.join(apps, 'Outil.app');
    expect(await checkUninstallable(target, context())).toEqual({ ok: true, path: target });
  });

  it('accepte une app de ~/Applications', async () => {
    const target = path.join(userApps, 'Perso.app');
    expect(await checkUninstallable(target, context())).toEqual({ ok: true, path: target });
  });

  it.each([
    ['une app d’un autre propriétaire', 'Outil.app', { uid: uid + 1 }, 'not-owner'],
    ['une app Apple', 'Notes.app', {}, 'apple-app'],
    ['une app de l’App Store', 'Boutique.app', {}, 'app-store'],
    ['une app sans identifiant', 'SansId.app', {}, 'not-app'],
    ['un lien symbolique vers une app', 'Lien.app', {}, 'not-app'],
    ['un fichier nommé .app', 'Fichier.app', {}, 'not-app'],
    ['une app sous-dossier de Applications', 'Utilitaires/Sous.app', {}, 'not-app'],
    ['le dossier Applications lui-même', '', {}, 'not-app'],
    ['une app absente', 'Absente.app', {}, 'not-found'],
    ['une app sans confirmation', 'Outil.app', { confirmed: false }, 'not-confirmed'],
  ] as const)('refuse %s', async (_label, relative, over, reason) => {
    const target = relative ? path.join(apps, relative) : apps;
    expect(await checkUninstallable(target, context(over))).toEqual({ ok: false, reason });
  });

  it('refuse une app hors des dossiers Applications', async () => {
    const target = path.join(base, 'Ailleurs/Cible.app');
    expect(await checkUninstallable(target, context())).toEqual({
      ok: false,
      reason: 'outside-root',
    });
  });

  it.each(['/Applications/../Applications/Outil.app', 'Applications/Outil.app', 42, ''])(
    'refuse une entrée invalide %s',
    async (input) => {
      expect(await checkUninstallable(input, context())).toEqual({
        ok: false,
        reason: 'invalid-input',
      });
    },
  );

  it('ne lit pas l’identifiant d’une app refusée plus tôt', async () => {
    let reads = 0;
    const counting = context({
      uid: uid + 1,
      readBundleId: () => {
        reads += 1;
        return Promise.resolve('com.acme.outil');
      },
    });
    await checkUninstallable(path.join(apps, 'Outil.app'), counting);
    expect(reads).toBe(0);
  });
});
