import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { DiskAccess } from '../shared/types';

/** Folders macOS opens only to apps with Full Disk Access; reading them is harmless. */
const PROBES = ['Library/Safari', 'Library/Mail', 'Library/Messages'];

/** The System Settings pane, opened by its fixed URL scheme: not a web address. */
export const FULL_DISK_ACCESS_SETTINGS =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles';

function code(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error ? String(error.code) : undefined;
}

/**
 * macOS has no API to ask: MacSweep lists protected folders. One refusal means no access,
 * one success means access; with none of them present the answer is unknown.
 */
export async function checkFullDiskAccess(home: string): Promise<DiskAccess> {
  let readable = false;
  for (const probe of PROBES) {
    try {
      await readdir(path.join(home, probe));
      readable = true;
    } catch (error) {
      const errorCode = code(error);
      if (errorCode === 'EPERM' || errorCode === 'EACCES') return 'denied';
    }
  }
  return readable ? 'granted' : 'unknown';
}
