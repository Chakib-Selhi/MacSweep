import { chmod, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkFullDiskAccess, FULL_DISK_ACCESS_SETTINGS } from '../../src/main/disk-access';

// A fake home folder: the probes never read the real ~/Library (rule 5).
let home: string;
const library = (name: string) => path.join(home, 'Library', name);

beforeEach(async () => {
  home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'macsweep-fda-')));
});

afterEach(async () => {
  for (const name of ['Safari', 'Mail', 'Messages']) {
    await chmod(library(name), 0o755).catch(() => undefined);
  }
  await rm(home, { recursive: true, force: true });
});

describe('checkFullDiskAccess', () => {
  it('répond « inconnu » quand aucun dossier protégé n’existe', async () => {
    expect(await checkFullDiskAccess(home)).toBe('unknown');
  });

  it('répond « accordé » quand un dossier protégé se lit', async () => {
    await mkdir(library('Safari'), { recursive: true });
    expect(await checkFullDiskAccess(home)).toBe('granted');
  });

  it('répond « refusé » dès qu’un dossier protégé refuse la lecture', async () => {
    await mkdir(library('Safari'), { recursive: true });
    await mkdir(library('Mail'), { recursive: true });
    await chmod(library('Mail'), 0o000);
    expect(await checkFullDiskAccess(home)).toBe('denied');
  });

  it('ouvre seulement le panneau Accès complet au disque des Réglages Système', () => {
    expect(FULL_DISK_ACCESS_SETTINGS).toBe(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
    );
  });
});
