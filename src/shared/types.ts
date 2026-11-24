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

export interface InvokeContract {
  'disk:info': { args: []; result: DiskInfo };
  'scan:start': { args: [request?: ScanRequest]; result: string };
  'scan:cancel': { args: [scanId: string]; result: void };
  'fs:reveal': { args: [path: string]; result: void };
}

export interface EventContract {
  'scan:progress': ScanProgress;
  'scan:done': ScanDone;
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
}
