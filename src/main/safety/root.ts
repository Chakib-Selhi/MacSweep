import { realpath } from 'node:fs/promises';
import path from 'node:path';

export const TEST_ROOT_ENV = 'MACSWEEP_TEST_ROOT';

interface RootInput {
  homedir: string;
  tmpdir: string;
  override: string | undefined;
  isPackaged: boolean;
}

/**
 * The root the whole app works under: the home folder, or for automated tests only,
 * a folder inside the temporary directory. An invalid override stops the app rather than
 * silently falling back to the real home folder.
 */
export async function pickRoot({
  homedir,
  tmpdir,
  override,
  isPackaged,
}: RootInput): Promise<string> {
  if (!override || isPackaged) return homedir;

  const [realOverride, realTmp] = await Promise.all([
    realpath(override).catch(() => null),
    realpath(tmpdir),
  ]);
  if (!realOverride || !realOverride.startsWith(realTmp + path.sep)) {
    throw new Error(`${TEST_ROOT_ENV} doit désigner un dossier existant dans ${tmpdir}`);
  }
  return realOverride;
}

/**
 * The folder « Tout le disque » explores: `/` in the app. For automated tests, the parent of the
 * test root when it still lies inside the temporary directory, so nothing outside it is read.
 */
export async function pickDiskRoot({
  root,
  tmpdir,
  testMode,
}: {
  root: string;
  tmpdir: string;
  testMode: boolean;
}): Promise<string> {
  if (!testMode) return '/';
  const realTmp = await realpath(tmpdir);
  const parent = path.dirname(root);
  return parent.startsWith(realTmp + path.sep) ? parent : root;
}
