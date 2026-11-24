import { execFile } from 'node:child_process';
import { access, constants } from 'node:fs/promises';

/** Runs a program with fixed arguments and no shell. Resolves with stdout. */
export type ToolRunner = (file: string, args: readonly string[]) => Promise<string>;

export interface ToolDeps {
  run: ToolRunner;
  /** First executable path that exists, or null. */
  findExecutable(candidates: readonly string[]): Promise<string | null>;
}

const TIMEOUT_MS = 15_000;

export function createToolDeps(home: string): ToolDeps {
  const env = {
    HOME: home,
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    HOMEBREW_NO_AUTO_UPDATE: '1',
    HOMEBREW_NO_ANALYTICS: '1',
    HOMEBREW_NO_ENV_HINTS: '1',
  };
  return {
    run: (file, args) =>
      new Promise((resolve, reject) => {
        execFile(
          file,
          [...args],
          { env, timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
          (error, stdout) => {
            if (error) reject(new Error(`${file} a échoué : ${error.message}`));
            else resolve(stdout);
          },
        );
      }),
    async findExecutable(candidates) {
      for (const candidate of candidates) {
        try {
          await access(candidate, constants.X_OK);
          return candidate;
        } catch {
          // Try the next location.
        }
      }
      return null;
    },
  };
}

export const BREW_LOCATIONS = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'];
export const XCODE_SELECT = '/usr/bin/xcode-select';
export const XCRUN = '/usr/bin/xcrun';
