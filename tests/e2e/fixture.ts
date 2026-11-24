import { _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface FakeHome {
  root: string;
  file(relative: string, bytes?: number): Promise<void>;
  cleanup(): Promise<void>;
}

/** A fake home folder in the temporary directory: the app never sees the real one (rule 5). */
export async function createFakeHome(): Promise<FakeHome> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'macsweep-e2e-'));
  return {
    root,
    async file(relative, bytes = 4096) {
      const target = path.join(root, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, Buffer.alloc(bytes, 1));
    },
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

export function launchApp(home: FakeHome): Promise<ElectronApplication> {
  return electron.launch({
    args: ['.'],
    cwd: process.cwd(),
    env: { ...process.env, MACSWEEP_TEST_ROOT: home.root },
  });
}
