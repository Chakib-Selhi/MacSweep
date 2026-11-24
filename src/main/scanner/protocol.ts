import type { ScanDone, ScanProgress } from '../../shared/types';
import type { ScanConfig } from './scan';

export interface WorkerInput {
  config: ScanConfig;
  /** One Int32: the main thread sets it to 1 to cancel. Read without waiting for messages. */
  cancelBuffer: SharedArrayBuffer;
}

export type WorkerMessage =
  { type: 'progress'; progress: ScanProgress } | { type: 'done'; done: ScanDone };

export const CANCEL_REQUESTED = 1;
