import { mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pickRoot } from '../../src/main/safety/root';

let fixture: string;

beforeAll(async () => {
  fixture = await mkdtemp(path.join(os.tmpdir(), 'macsweep-root-'));
});

afterAll(async () => {
  await rm(fixture, { recursive: true, force: true });
});

const base = { homedir: '/Users/quelquun', tmpdir: os.tmpdir() };

describe('pickRoot', () => {
  it('utilise le dossier utilisateur sans variable de test', async () => {
    expect(await pickRoot({ ...base, override: undefined, isPackaged: false })).toBe(base.homedir);
  });

  it('ignore la variable de test dans l’app installée', async () => {
    expect(await pickRoot({ ...base, override: fixture, isPackaged: true })).toBe(base.homedir);
  });

  it('accepte une racine de test sous le dossier temporaire', async () => {
    expect(await pickRoot({ ...base, override: fixture, isPackaged: false })).toBe(
      await realpath(fixture),
    );
  });

  it.each(['/Users', '/', os.homedir(), '/chemin/inexistant'])(
    'refuse de démarrer avec la racine de test %s',
    async (override) => {
      await expect(pickRoot({ ...base, override, isPackaged: false })).rejects.toThrow();
    },
  );

  it('refuse le dossier temporaire lui-même', async () => {
    await expect(pickRoot({ ...base, override: os.tmpdir(), isPackaged: false })).rejects.toThrow();
  });
});
