import { shell } from 'electron';
import { lstat, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';

export type TrashMover = (target: string) => Promise<void>;

/** The real macOS Trash: items can be put back from the Finder. */
export const macTrash: TrashMover = (target) => shell.trashItem(target);

/**
 * Automated tests only: moves items into `<test root>/.Trash`, so a test run never fills the
 * user's real Trash. Never used by the packaged app.
 */
export function testTrash(testRoot: string): TrashMover {
  const trashDir = path.join(testRoot, '.Trash');
  return async (target) => {
    await mkdir(trashDir, { recursive: true });
    const base = path.basename(target);
    let destination = path.join(trashDir, base);
    for (let n = 2; await exists(destination); n += 1) {
      destination = path.join(trashDir, `${base} ${n}`);
    }
    await rename(target, destination);
  };
}

async function exists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch {
    return false;
  }
}
