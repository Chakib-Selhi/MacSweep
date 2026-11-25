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
  /** Inside Documents, Desktop or Pictures: cleaning it needs an extra confirmation (D9). */
  protected?: boolean;
  /** Large files: what kind of file it is, for the type filters. */
  fileKind?: FileKind;
  /** Duplicates: the group of identical files it belongs to. */
  groupId?: string;
}

export type FileKind = 'video' | 'disk-image' | 'archive' | 'other';

/** Identical files (same SHA-256). `files` is sorted oldest first: the first one is kept. */
export interface DuplicateGroup {
  id: string;
  sizeBytes: number;
  files: ScanItem[];
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
  duplicateGroups: DuplicateGroup[];
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
  | 'broken-symlink'
  /** Shown by the disk map but never cleaned from it (D45). */
  | 'read-only';

export type CleanFailureReason =
  | GuardRefusal
  /** Not part of the latest scan: only what MacSweep itself reported can be cleaned. */
  | 'not-scanned'
  /** The app the item belongs to is running (rule 6). */
  | 'app-open'
  /** Running apps could not be listed, so rule 6 could not be checked. */
  | 'app-check-failed'
  /** macOS refused to move the item (locked file, permission). */
  | 'trash-failed'
  /** A high-risk category needs the extra confirmation of the clean dialog. */
  | 'needs-confirmation'
  /** Listed to explain disk usage only (Docker image), never cleaned. */
  | 'info-only'
  /** It is the last remaining copy of a group of duplicates. */
  | 'last-copy'
  /** Inside a folder of the exclusion list (F7). */
  | 'excluded';

export interface Settings {
  /** Simulation: show what would be moved without moving anything. On at first launch. */
  dryRun: boolean;
  /** Folders MacSweep never scans nor touches. */
  exclusions: string[];
  /** Large files: only files at least this big are listed (F5). */
  largeFileThresholdBytes: number;
  downloadsMinAgeDays: number;
  nodeModulesMinAgeDays: number;
  /** Folders searched for old node_modules. */
  projectDirs: string[];
  /** Folders searched for duplicates (F6). */
  duplicateDirs: string[];
  duplicateMinBytes: number;
}

export interface CleanRequest {
  dryRun: boolean;
  /** Typed confirmation for files inside Documents, Desktop or Pictures. */
  confirmProtected?: boolean;
  /** Typed confirmation for high-risk categories (large files, duplicates, iPhone backups). */
  confirmHighRisk?: boolean;
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

/** « Mon dossier » (the home folder) or « Tout le disque » (`/`, read-only outside home). */
export type ExploreScope = 'home' | 'disk';

export interface ExploreEntry {
  /** `others`: the smaller files of the folder, grouped; its path is the folder's. */
  kind: 'directory' | 'file' | 'others';
  name: string;
  path: string;
  sizeBytes: number;
  fileCount: number;
  /** The folder could not be read: its size is what could be counted. */
  denied: boolean;
  /** Can go to the Trash from the disk map (D45); always false outside the home folder. */
  trashable: boolean;
  /** Inside Documents, Desktop or Pictures: trashing it needs the extra confirmation. */
  protected?: boolean;
}

export interface ExploreListing {
  path: string;
  sizeBytes: number;
  fileCount: number;
  denied: boolean;
  entries: ExploreEntry[];
}

export interface ExploreProgress {
  exploreId: string;
  filesVisited: number;
  bytesFound: number;
  currentDir: string;
}

export interface ExploreDone {
  exploreId: string;
  status: ScanStatus;
  scope: ExploreScope;
  /** The explored folder; the map can be browsed from here down. */
  rootPath: string;
  /** The home folder: only items under it can be offered for the Trash. */
  homePath: string;
  sizeBytes: number;
  fileCount: number;
  deniedCount: number;
  durationMs: number;
  error?: string;
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
  /** Native folder picker; resolves to a folder inside the home folder, or null if cancelled. */
  'dialog:pickFolder': { args: []; result: string | null };
  'explore:start': { args: [scope: ExploreScope]; result: string };
  'explore:cancel': { args: [exploreId: string]; result: void };
  /** null when the path is not part of the latest exploration. */
  'explore:list': { args: [path: string]; result: ExploreListing | null };
  'explore:trash': { args: [paths: string[], request: CleanRequest]; result: CleanReport };
}

export interface EventContract {
  'scan:progress': ScanProgress;
  'scan:done': ScanDone;
  'clean:progress': CleanProgress;
  'explore:progress': ExploreProgress;
  'explore:done': ExploreDone;
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
  dialog: {
    pickFolder(): Promise<string | null>;
  };
  explore: {
    start(scope: ExploreScope): Promise<string>;
    cancel(exploreId: string): Promise<void>;
    list(path: string): Promise<ExploreListing | null>;
    trash(paths: string[], request: CleanRequest): Promise<CleanReport>;
    onProgress(listener: (progress: ExploreProgress) => void): Unsubscribe;
    onDone(listener: (done: ExploreDone) => void): Unsubscribe;
  };
}
