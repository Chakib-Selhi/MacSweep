import type { CategoryId } from './categories';

export interface DiskInfo {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
}

export interface ScanRequest {
  categories?: CategoryId[];
}

export interface ScanItem {
  path: string;
  sizeBytes: number;
  /** Most recent modification inside the item (the item itself for a file). */
  modifiedMs: number;
  isDirectory: boolean;
  /** Set when the app this item belongs to is running: it is then left unchecked (rule 6). */
  openApp?: string;
}

export interface CategoryResult {
  id: CategoryId;
  items: ScanItem[];
  totalBytes: number;
  filesVisited: number;
}

export interface ScanProgress {
  scanId: string;
  categoryId: CategoryId;
  filesVisited: number;
  bytesFound: number;
  currentDir: string;
}

export type ScanStatus = 'completed' | 'cancelled' | 'failed';

export interface ScanDone {
  scanId: string;
  status: ScanStatus;
  /** Folder the scan ran under (the home folder), used to show paths as ~/… */
  root: string;
  /** Sorted by total size, largest first. Categories whose tool or folder is missing are absent. */
  categories: CategoryResult[];
  deniedCount: number;
  /** First denied folders, capped so a huge permission problem does not flood the UI. */
  deniedDirs: string[];
  durationMs: number;
  error?: string;
}

/** Why src/main/safety/guard.ts refuses a path. */
export type GuardRefusal =
  | 'invalid-input'
  | 'not-found'
  | 'unreadable'
  | 'outside-root'
  | 'is-root'
  | 'forbidden'
  | 'protected'
  | 'git'
  | 'trash'
  | 'broken-symlink';

export type CleanFailureReason =
  | GuardRefusal
  /** Not part of the latest scan: only what MacSweep itself reported can be cleaned. */
  | 'not-scanned'
  /** The app the item belongs to is running (rule 6). */
  | 'app-open'
  /** Running apps could not be listed, so rule 6 could not be checked. */
  | 'app-check-failed'
  /** macOS refused to move the item (locked file, permission). */
  | 'trash-failed';

export interface Settings {
  /** Simulation: show what would be moved without moving anything. On at first launch. */
  dryRun: boolean;
}

export interface CleanRequest {
  dryRun: boolean;
}

export interface CleanedItem {
  path: string;
  sizeBytes: number;
  categoryId: CategoryId;
}

export interface CleanFailure {
  path: string;
  reason: CleanFailureReason;
  message?: string;
}

export interface CleanReport {
  dryRun: boolean;
  moved: CleanedItem[];
  failed: CleanFailure[];
  bytesFreed: number;
  durationMs: number;
}

export interface CleanProgress {
  done: number;
  total: number;
  currentPath: string;
}

export interface TrashReport {
  dryRun: boolean;
  deletedCount: number;
  bytesFreed: number;
  failed: { path: string; message: string }[];
}

export interface HistoryEntry {
  id: string;
  dateMs: number;
  kind: 'clean' | 'empty-trash';
  categories: CategoryId[];
  bytesFreed: number;
  movedCount: number;
  failedCount: number;
}

export interface InvokeContract {
  'disk:info': { args: []; result: DiskInfo };
  'scan:start': { args: [request?: ScanRequest]; result: string };
  'scan:cancel': { args: [scanId: string]; result: void };
  'fs:reveal': { args: [path: string]; result: void };
  'clean:execute': { args: [paths: string[], request: CleanRequest]; result: CleanReport };
  'trash:empty': { args: [confirmation: string]; result: TrashReport };
  'settings:get': { args: []; result: Settings };
  'settings:set': { args: [patch: Partial<Settings>]; result: Settings };
  'history:list': { args: []; result: HistoryEntry[] };
}

export interface EventContract {
  'scan:progress': ScanProgress;
  'scan:done': ScanDone;
  'clean:progress': CleanProgress;
}

export type InvokeChannel = keyof InvokeContract;
export type InvokeArgs<C extends InvokeChannel> = InvokeContract[C]['args'];
export type InvokeResult<C extends InvokeChannel> = InvokeContract[C]['result'];
export type EventChannel = keyof EventContract;

export type Unsubscribe = () => void;

export interface MacSweepApi {
  disk: {
    info(): Promise<DiskInfo>;
  };
  scan: {
    start(request?: ScanRequest): Promise<string>;
    cancel(scanId: string): Promise<void>;
    onProgress(listener: (progress: ScanProgress) => void): Unsubscribe;
    onDone(listener: (done: ScanDone) => void): Unsubscribe;
  };
  fs: {
    reveal(path: string): Promise<void>;
  };
  clean: {
    execute(paths: string[], request: CleanRequest): Promise<CleanReport>;
    onProgress(listener: (progress: CleanProgress) => void): Unsubscribe;
  };
  trash: {
    /** Permanent. `confirmation` must be the word typed by the user: « VIDER ». */
    empty(confirmation: string): Promise<TrashReport>;
  };
  settings: {
    get(): Promise<Settings>;
    set(patch: Partial<Settings>): Promise<Settings>;
  };
  history: {
    list(): Promise<HistoryEntry[]>;
  };
}
