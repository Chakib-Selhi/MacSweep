import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import type { CategoryId } from '../../shared/categories';
import type { ScanDone, ScanProgress, ScanStatus } from '../../shared/types';
import { CANCEL_REQUESTED, type WorkerInput, type WorkerMessage } from './protocol';
import type { ScanConfig } from './scan';

export interface ScanSink {
  progress(progress: ScanProgress): void;
  done(done: ScanDone): void;
}

export type BaseScanConfig = Omit<ScanConfig, 'scanId' | 'categories'>;

interface ActiveScan {
  scanId: string;
  worker: Worker;
  cancelFlag: Int32Array;
  sink: ScanSink;
  startedAt: number;
  killTimer?: NodeJS.Timeout;
}

/** If the worker has not stopped on its own by then, it is terminated (target: under one second). */
const FORCE_STOP_AFTER_MS = 500;

export class ScanService {
  private active: ActiveScan | null = null;

  constructor(
    private readonly workerPath: string,
    private readonly baseConfig: () => BaseScanConfig,
  ) {}

  /** One scan at a time: a second request is refused rather than queued. */
  start(categories: readonly CategoryId[], sink: ScanSink): string {
    if (this.active) throw new Error('Un scan est déjà en cours');

    const scanId = randomUUID();
    const cancelBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const input: WorkerInput = {
      config: { ...this.baseConfig(), scanId, categories: [...categories] },
      cancelBuffer,
    };
    const worker = new Worker(this.workerPath, { workerData: input });
    const scan: ActiveScan = {
      scanId,
      worker,
      cancelFlag: new Int32Array(cancelBuffer),
      sink,
      startedAt: Date.now(),
    };
    this.active = scan;

    worker.on('message', (message: WorkerMessage) => {
      if (this.active !== scan) return;
      if (message.type === 'progress') sink.progress(message.progress);
      else this.finish(scan, message.done);
    });
    worker.on('error', (error: Error) =>
      this.finish(scan, this.emptyDone(scan, 'failed', error.message)),
    );
    worker.on('exit', () => {
      const cancelled = Atomics.load(scan.cancelFlag, 0) === CANCEL_REQUESTED;
      this.finish(
        scan,
        this.emptyDone(
          scan,
          cancelled ? 'cancelled' : 'failed',
          cancelled ? undefined : 'Arrêt inattendu du scan',
        ),
      );
    });
    return scanId;
  }

  cancel(scanId: string): void {
    const scan = this.active;
    if (!scan || scan.scanId !== scanId) return;
    Atomics.store(scan.cancelFlag, 0, CANCEL_REQUESTED);
    scan.killTimer ??= setTimeout(() => {
      if (this.active !== scan) return;
      void scan.worker.terminate();
      this.finish(scan, this.emptyDone(scan, 'cancelled'));
    }, FORCE_STOP_AFTER_MS);
  }

  dispose(): void {
    const scan = this.active;
    if (!scan) return;
    this.active = null;
    clearTimeout(scan.killTimer);
    void scan.worker.terminate();
  }

  private finish(scan: ActiveScan, done: ScanDone): void {
    if (this.active !== scan) return;
    this.active = null;
    clearTimeout(scan.killTimer);
    scan.sink.done(done);
  }

  private emptyDone(scan: ActiveScan, status: ScanStatus, error?: string): ScanDone {
    return {
      scanId: scan.scanId,
      status,
      categories: [],
      deniedCount: 0,
      deniedDirs: [],
      durationMs: Date.now() - scan.startedAt,
      ...(error === undefined ? {} : { error }),
    };
  }
}
