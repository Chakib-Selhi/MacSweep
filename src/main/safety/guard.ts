import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { GuardRefusal } from '../../shared/types';

export type Refusal = GuardRefusal;

export type GuardResult = { ok: true; path: string } | { ok: false; reason: Refusal };

export interface TrashOptions {
  confirmProtected?: boolean;
}

export interface Guard {
  readonly root: string;
  checkReadable(input: unknown): Promise<GuardResult>;
  checkTrashable(input: unknown, options?: TrashOptions): Promise<GuardResult>;
}

const MAX_PATH_LENGTH = 4096;

const SYSTEM_PATHS = ['/System', '/usr', '/bin', '/sbin', '/Library', '/Applications'];

const FORBIDDEN_IN_ROOT = [
  'Library/Mobile Documents',
  'Library/Keychains',
  'Library/Mail',
  'Library/Messages',
  'Library/Photos',
  '.ssh',
  '.gnupg',
];

const PROTECTED_IN_ROOT = ['Documents', 'Desktop', 'Pictures'];

const TRASH_DIR = '.Trash';
const GIT_DIR = '.git';

// APFS is case-insensitive and normalization-insensitive by default: compare like it does.
function key(segment: string): string {
  return segment.normalize('NFC').toLowerCase();
}

function segments(p: string): string[] {
  return p.split('/').filter(Boolean).map(key);
}

function startsWith(full: readonly string[], prefix: readonly string[]): boolean {
  return prefix.length <= full.length && prefix.every((segment, i) => full[i] === segment);
}

const SYSTEM_SEGMENTS = SYSTEM_PATHS.map(segments);
const FORBIDDEN_SEGMENTS = FORBIDDEN_IN_ROOT.map(segments);
const PROTECTED_SEGMENTS = PROTECTED_IN_ROOT.map(segments);
const TRASH_KEY = key(TRASH_DIR);
const GIT_KEY = key(GIT_DIR);

/**
 * Pure, lexical check of an absolute, already-resolved path against rules 1 and 2.
 * `roots` lists equivalent spellings of the root (as given and as resolved).
 */
export function classifyPath(
  absolutePath: string,
  roots: readonly string[],
  options: TrashOptions = {},
): Refusal | null {
  const target = segments(absolutePath);
  if (SYSTEM_SEGMENTS.some((system) => startsWith(target, system))) return 'forbidden';

  const rootSegments = roots.map(segments).find((root) => startsWith(target, root));
  if (!rootSegments) return 'outside-root';

  const relative = target.slice(rootSegments.length);
  if (relative.length === 0) return 'is-root';
  if (relative.includes(GIT_KEY)) return 'git';
  if (relative[0] === TRASH_KEY) return 'trash';

  // A path inside a forbidden folder, or one that contains it (trashing ~/Library would take Keychains).
  if (FORBIDDEN_SEGMENTS.some((f) => startsWith(relative, f) || startsWith(f, relative))) {
    return 'forbidden';
  }
  for (const protectedDir of PROTECTED_SEGMENTS) {
    if (!startsWith(relative, protectedDir)) continue;
    if (relative.length === protectedDir.length) return 'forbidden';
    if (!options.confirmProtected) return 'protected';
  }
  return null;
}

function normalizeInput(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  if (input.length === 0 || input.length > MAX_PATH_LENGTH || input.includes('\0')) return null;
  if (!path.isAbsolute(input)) return null;
  // Paths from a scan are always canonical: any `.` or `..` segment means a forged request.
  if (input.split('/').some((segment) => segment === '.' || segment === '..')) return null;
  return path.resolve(input);
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error ? String(error.code) : undefined;
}

async function exists(p: string): Promise<boolean> {
  try {
    await lstat(p);
    return true;
  } catch {
    return false;
  }
}

const refuse = (reason: Refusal): GuardResult => ({ ok: false, reason });

export async function createGuard({ root }: { root: string }): Promise<Guard> {
  const realRoot = await realpath(root);
  if (realRoot === path.parse(realRoot).root) {
    throw new Error('La racine ne peut pas être la racine du disque');
  }
  const givenRoot = path.resolve(root);
  const inputRoots = [givenRoot, realRoot];

  /** Where the entry itself lives, with its parent resolved but the entry not followed. */
  async function locate(
    absolute: string,
  ): Promise<{ physical: string; isLink: boolean; isDir: boolean } | Refusal> {
    let stats;
    try {
      stats = await lstat(absolute);
    } catch (error) {
      const code = errorCode(error);
      return code === 'ENOENT' || code === 'ENOTDIR' ? 'not-found' : 'unreadable';
    }
    let parent: string;
    try {
      parent = await realpath(path.dirname(absolute));
    } catch {
      return 'unreadable';
    }
    return {
      physical: path.join(parent, path.basename(absolute)),
      isLink: stats.isSymbolicLink(),
      isDir: stats.isDirectory(),
    };
  }

  async function linkTarget(absolute: string): Promise<string | null> {
    try {
      return await realpath(absolute);
    } catch {
      return null;
    }
  }

  return {
    root: realRoot,

    async checkReadable(input) {
      const absolute = normalizeInput(input);
      if (!absolute) return refuse('invalid-input');
      const located = await locate(absolute);
      if (typeof located === 'string') return refuse(located);

      const target = located.isLink ? await linkTarget(absolute) : located.physical;
      if (!target) return refuse('broken-symlink');
      for (const candidate of [located.physical, target]) {
        if (classifyPath(candidate, [realRoot]) === 'outside-root') return refuse('outside-root');
      }
      return { ok: true, path: located.physical };
    },

    async checkTrashable(input, options = {}) {
      const absolute = normalizeInput(input);
      if (!absolute) return refuse('invalid-input');

      // Lexical pass on the path as received: catches the blacklist before touching the disk.
      const early = classifyPath(absolute, inputRoots, options);
      if (early && early !== 'outside-root') return refuse(early);

      const located = await locate(absolute);
      if (typeof located === 'string') return refuse(located);

      // Authoritative pass on where the entry really is, parents' symlinks resolved.
      const physical = classifyPath(located.physical, [realRoot], options);
      if (physical) return refuse(physical);

      if (located.isLink) {
        const target = await linkTarget(absolute);
        if (!target) return refuse('broken-symlink');
        const refusal = classifyPath(target, [realRoot], options);
        if (refusal) return refuse(refusal);
      } else if (located.isDir && (await exists(path.join(located.physical, GIT_DIR)))) {
        return refuse('git');
      }
      return { ok: true, path: located.physical };
    },
  };
}

export class GuardInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GuardInputError';
  }
}

export interface ScreenedPaths {
  accepted: string[];
  refused: { input: string; reason: Refusal }[];
}

const MAX_PATHS_PER_REQUEST = 200_000;

/** Every list of paths received over IPC goes through here before any action. */
export async function screenPaths(
  guard: Guard,
  raw: unknown,
  options: TrashOptions = {},
): Promise<ScreenedPaths> {
  if (!Array.isArray(raw)) throw new GuardInputError('La liste de chemins doit être un tableau');
  if (raw.length > MAX_PATHS_PER_REQUEST) throw new GuardInputError('Trop de chemins');

  const accepted = new Set<string>();
  const refused: ScreenedPaths['refused'] = [];
  for (const input of raw as unknown[]) {
    const result = await guard.checkTrashable(input, options);
    if (result.ok) accepted.add(result.path);
    else
      refused.push({
        input: typeof input === 'string' ? input : `<${typeof input}>`,
        reason: result.reason,
      });
  }
  return { accepted: [...accepted], refused };
}
