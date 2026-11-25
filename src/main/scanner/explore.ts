import { lstatSync, opendirSync, type Dir } from 'node:fs';
import path from 'node:path';
import type { ExploreEntry, ExploreListing } from '../../shared/types';
import type { CleanRegistry } from '../cleaner';

export const KIND_DIR = 0;
export const KIND_FILE = 1;
/** The smaller files of a folder, beyond the ones kept one by one, grouped in a single node. */
export const KIND_OTHERS = 2;

/** The disk map as flat arrays: cheap to send from the worker (typed arrays are transferred). */
export interface FlatTree {
  rootPath: string;
  names: string[];
  /** Index of the parent node, -1 for the root. A child always comes after its parent. */
  parents: Int32Array;
  kinds: Uint8Array;
  bytes: Float64Array;
  files: Float64Array;
  denied: Uint8Array;
  filesVisited: number;
  deniedCount: number;
  stopped: boolean;
}

export interface ExploreWalkOptions {
  rootPath: string;
  skip(absolutePath: string): boolean;
  shouldStop(): boolean;
  onTick(currentDir: string, filesVisited: number, bytesFound: number): void;
  topFilesPerDir?: number;
}

const DEFAULT_TOP_FILES = 50;
const TICK_EVERY = 512;

function code(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error ? String(error.code) : undefined;
}

/**
 * Walks a folder like `du` (allocated blocks, symlinks never followed, hardlinks counted once)
 * and keeps every folder plus the largest files of each one. Synchronous: it runs in a worker.
 */
export function buildExploreTree(options: ExploreWalkOptions): FlatTree {
  const topFiles = options.topFilesPerDir ?? DEFAULT_TOP_FILES;
  const names: string[] = [];
  const parents: number[] = [];
  const kinds: number[] = [];
  const bytes: number[] = [];
  const files: number[] = [];
  const denied: number[] = [];
  const seenInodes = new Set<string>();
  let filesVisited = 0;
  let deniedCount = 0;
  let bytesFound = 0;
  let stopped = false;

  const add = (name: string, parent: number, kind: number, size: number, count: number) => {
    names.push(name);
    parents.push(parent);
    kinds.push(kind);
    bytes.push(size);
    files.push(count);
    denied.push(0);
    return names.length - 1;
  };
  const markDenied = (index: number) => {
    denied[index] = 1;
    deniedCount += 1;
  };

  const rootStats = lstatSync(options.rootPath);
  add(options.rootPath, -1, KIND_DIR, rootStats.blocks * 512, 0);
  const stack: [number, string][] = [[0, options.rootPath]];

  while (stack.length > 0) {
    if (options.shouldStop()) {
      stopped = true;
      break;
    }
    const [index, dir] = stack.pop() as [number, string];
    let handle: Dir;
    try {
      handle = opendirSync(dir);
    } catch (error) {
      const errorCode = code(error);
      if (errorCode !== 'ENOENT' && errorCode !== 'ENOTDIR') markDenied(index);
      continue;
    }
    const dirFiles: { name: string; size: number }[] = [];
    try {
      for (let entry = handle.readSync(); entry !== null; entry = handle.readSync()) {
        const child = path.join(dir, entry.name);
        let stats;
        try {
          stats = lstatSync(child);
        } catch {
          continue;
        }
        filesVisited += 1;
        if (filesVisited % TICK_EVERY === 0) options.onTick(dir, filesVisited, bytesFound);
        if (stats.isDirectory()) {
          if (options.skip(child)) continue;
          const size = stats.blocks * 512;
          bytesFound += size;
          stack.push([add(entry.name, index, KIND_DIR, size, 0), child]);
          continue;
        }
        let size = stats.blocks * 512;
        if (stats.nlink > 1) {
          const inode = `${stats.dev}:${stats.ino}`;
          if (seenInodes.has(inode)) size = 0;
          else seenInodes.add(inode);
        }
        bytesFound += size;
        dirFiles.push({ name: entry.name, size });
      }
    } catch (error) {
      if (code(error) !== 'ENOENT') markDenied(index);
    } finally {
      handle.closeSync();
    }

    dirFiles.sort((a, b) => b.size - a.size);
    for (const item of dirFiles.slice(0, topFiles)) add(item.name, index, KIND_FILE, item.size, 1);
    const rest = dirFiles.slice(topFiles);
    if (rest.length > 0) {
      const size = rest.reduce((sum, item) => sum + item.size, 0);
      add('', index, KIND_OTHERS, size, rest.length);
    }
  }

  // Children come after their parent: walking backwards adds each total into its parent.
  for (let i = names.length - 1; i > 0; i -= 1) {
    const parent = parents[i] as number;
    bytes[parent] = (bytes[parent] as number) + (bytes[i] as number);
    files[parent] = (files[parent] as number) + (files[i] as number);
  }

  return {
    rootPath: options.rootPath,
    names,
    parents: Int32Array.from(parents),
    kinds: Uint8Array.from(kinds),
    bytes: Float64Array.from(bytes),
    files: Float64Array.from(files),
    denied: Uint8Array.from(denied),
    filesVisited,
    deniedCount,
    stopped,
  };
}

/**
 * Folders never entered. On `/`: the other views of the same data (APFS firmlinks under
 * /System/Volumes), other disks and virtual file systems, so nothing is counted twice (D45).
 */
const SKIPPED_ON_DISK = ['/System/Volumes', '/Volumes', '/dev', '/net', '/home', '/Network'];

export function diskSkipper(
  rootPath: string,
  exclusions: readonly string[],
): (dir: string) => boolean {
  const skipped = rootPath === '/' ? [...SKIPPED_ON_DISK, ...exclusions] : [...exclusions];
  return (dir) => skipped.some((prefix) => dir === prefix || dir.startsWith(`${prefix}/`));
}

export const DEFAULT_LIST_LIMIT = 300;

/** The disk map in the main process: answers the interface without touching the disk again. */
export class ExploreTree {
  readonly rootPath: string;
  private readonly flat: FlatTree;
  private readonly removed: Uint8Array;
  private readonly childStart: Int32Array;
  private readonly childList: Int32Array;

  constructor(flat: FlatTree) {
    this.flat = flat;
    this.rootPath = flat.rootPath;
    const count = flat.names.length;
    this.removed = new Uint8Array(count);
    this.childStart = new Int32Array(count + 1);
    for (let i = 1; i < count; i += 1) {
      const slot = (flat.parents[i] as number) + 1;
      this.childStart[slot] = (this.childStart[slot] as number) + 1;
    }
    for (let i = 1; i <= count; i += 1) {
      this.childStart[i] = (this.childStart[i] as number) + (this.childStart[i - 1] as number);
    }
    const fill = this.childStart.slice(0, count);
    this.childList = new Int32Array(Math.max(count - 1, 0));
    for (let i = 1; i < count; i += 1) {
      const parent = flat.parents[i] as number;
      const at = fill[parent] as number;
      this.childList[at] = i;
      fill[parent] = at + 1;
    }
  }

  get totalBytes(): number {
    return this.flat.bytes[0] ?? 0;
  }

  get totalFiles(): number {
    return this.flat.files[0] ?? 0;
  }

  get(
    absolutePath: string,
  ): { sizeBytes: number; isDirectory: boolean; denied: boolean } | undefined {
    const index = this.indexOf(absolutePath);
    if (index < 0) return undefined;
    return {
      sizeBytes: this.flat.bytes[index] as number,
      isDirectory: this.flat.kinds[index] === KIND_DIR,
      denied: this.flat.denied[index] === 1,
    };
  }

  /** A folder's content, largest first; beyond `limit`, the rest is grouped in one entry. */
  list(absolutePath: string, limit = DEFAULT_LIST_LIMIT): ExploreListing | null {
    const index = this.indexOf(absolutePath);
    if (index < 0 || this.flat.kinds[index] !== KIND_DIR) return null;
    const children = this.children(index).sort(
      (a, b) => (this.flat.bytes[b] as number) - (this.flat.bytes[a] as number),
    );
    const entries: ExploreEntry[] = [];
    let othersBytes = 0;
    let othersFiles = 0;
    for (const child of children) {
      const kind = this.flat.kinds[child];
      if (kind === KIND_OTHERS || entries.length >= limit) {
        othersBytes += this.flat.bytes[child] as number;
        othersFiles += this.flat.files[child] as number;
        continue;
      }
      const name = this.flat.names[child] as string;
      entries.push({
        kind: kind === KIND_DIR ? 'directory' : 'file',
        name,
        path: path.join(absolutePath, name),
        sizeBytes: this.flat.bytes[child] as number,
        fileCount: this.flat.files[child] as number,
        denied: this.flat.denied[child] === 1,
        trashable: false,
      });
    }
    if (othersFiles > 0) {
      entries.push({
        kind: 'others',
        name: '',
        path: absolutePath,
        sizeBytes: othersBytes,
        fileCount: othersFiles,
        denied: false,
        trashable: false,
      });
    }
    return {
      path: absolutePath,
      sizeBytes: this.flat.bytes[index] as number,
      fileCount: this.flat.files[index] as number,
      denied: this.flat.denied[index] === 1,
      entries,
    };
  }

  /** After a move to the Trash: the item disappears and its size leaves every parent folder. */
  forget(absolutePath: string): void {
    const index = this.indexOf(absolutePath);
    if (index <= 0) return;
    const size = this.flat.bytes[index] as number;
    const count = this.flat.files[index] as number;
    this.removed[index] = 1;
    for (let parent = this.flat.parents[index] as number; parent >= 0;) {
      this.flat.bytes[parent] = (this.flat.bytes[parent] as number) - size;
      this.flat.files[parent] = (this.flat.files[parent] as number) - count;
      parent = this.flat.parents[parent] as number;
    }
  }

  private children(index: number): number[] {
    const result: number[] = [];
    const end = this.childStart[index + 1] as number;
    for (let at = this.childStart[index] as number; at < end; at += 1) {
      const child = this.childList[at] as number;
      if (this.removed[child] === 0) result.push(child);
    }
    return result;
  }

  private indexOf(absolutePath: string): number {
    if (absolutePath === this.rootPath) return 0;
    const prefix = this.rootPath === '/' ? '/' : `${this.rootPath}/`;
    if (!absolutePath.startsWith(prefix)) return -1;
    let index = 0;
    for (const segment of absolutePath.slice(prefix.length).split('/')) {
      if (this.flat.kinds[index] !== KIND_DIR) return -1;
      const next = this.children(index).find(
        (child) => this.flat.kinds[child] !== KIND_OTHERS && this.flat.names[child] === segment,
      );
      if (next === undefined) return -1;
      index = next;
    }
    return index;
  }
}

/**
 * Cleaning from the disk map: only what the map shows can go, never the explored folder itself,
 * nor a folder that could not be read whole (its real content is unknown).
 */
export function exploreRegistry(tree: ExploreTree): CleanRegistry {
  return {
    get(absolutePath) {
      if (absolutePath === tree.rootPath) return undefined;
      const node = tree.get(absolutePath);
      if (!node || node.denied) return undefined;
      return { categoryId: 'explorer', sizeBytes: node.sizeBytes };
    },
    groupSize: () => 0,
    forget: (absolutePath) => tree.forget(absolutePath),
  };
}
