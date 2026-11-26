import type { ExploreProgress, ScanDone, ScanProgress } from '../../shared/types';
import type { FlatTree } from './explore';
import type { ScanConfig } from './scan';

export interface WorkerInput {
  config: ScanConfig;
  /** One Int32: the main thread sets it to 1 to cancel. Read without waiting for messages. */
  cancelBuffer: SharedArrayBuffer;
}

export type WorkerMessage =
  { type: 'progress'; progress: ScanProgress } | { type: 'done'; done: ScanDone };

export const CANCEL_REQUESTED = 1;

/** The same worker file also builds the disk map (one build entry, two jobs). */
export interface ExploreWorkerInput {
  kind: 'explore';
  exploreId: string;
  rootPath: string;
  exclusions: string[];
  cancelBuffer: SharedArrayBuffer;
}

export type ExploreWorkerMessage =
  { type: 'progress'; progress: ExploreProgress } | { type: 'done'; tree: FlatTree };

/** Sizes of a list of paths (apps and their leftovers), measured like the scan does. */
export interface MeasureWorkerInput {
  kind: 'measure';
  paths: string[];
  cancelBuffer: SharedArrayBuffer;
}

export interface MeasureWorkerMessage {
  type: 'measured';
  sizes: number[];
}
