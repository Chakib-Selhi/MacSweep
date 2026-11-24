import path from 'node:path';
import type { FileKind } from '../../shared/types';

export const LARGE_FILES_LIMIT = 200;

/**
 * Folders that macOS shows as a single file (apps, photo and music libraries, projects, VMs).
 * Their inner files must never be offered one by one.
 */
const PACKAGE_EXTENSIONS = new Set([
  'app',
  'photoslibrary',
  'photolibrary',
  'musiclibrary',
  'tvlibrary',
  'imovielibrary',
  'fcpbundle',
  'logicx',
  'band',
  'xcarchive',
  'bundle',
  'framework',
  'plugin',
  'kext',
  'lrlibrary',
  'vmwarevm',
  'pvm',
  'utm',
  'sparsebundle',
  'rtfd',
  'pages',
  'numbers',
  'key',
]);

const KINDS: [FileKind, Set<string>][] = [
  ['video', new Set(['mp4', 'mov', 'm4v', 'mkv', 'avi', 'webm', 'wmv', 'flv', 'mpg', 'mpeg'])],
  [
    'disk-image',
    new Set(['dmg', 'iso', 'img', 'sparseimage', 'toast', 'vmdk', 'vdi', 'qcow2', 'ipsw']),
  ],
  ['archive', new Set(['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'zst', 'pkg', 'xip'])],
];

function extension(name: string): string {
  return path.extname(name).slice(1).toLowerCase();
}

export function fileKind(name: string): FileKind {
  const ext = extension(name);
  return KINDS.find(([, extensions]) => extensions.has(ext))?.[0] ?? 'other';
}

export function isPackage(name: string): boolean {
  return PACKAGE_EXTENSIONS.has(extension(name));
}

export interface LargeFile {
  path: string;
  sizeBytes: number;
  modifiedMs: number;
}

/** Keeps the `limit` biggest files seen, without sorting on every insertion. */
export class TopFiles {
  private files: LargeFile[] = [];

  constructor(private readonly limit = LARGE_FILES_LIMIT) {}

  add(file: LargeFile): void {
    this.files.push(file);
    if (this.files.length > this.limit * 2) this.trim();
  }

  result(): LargeFile[] {
    this.trim();
    return this.files;
  }

  private trim(): void {
    this.files.sort((a, b) => b.sizeBytes - a.sizeBytes);
    this.files.length = Math.min(this.files.length, this.limit);
  }
}
