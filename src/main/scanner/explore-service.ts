import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import type { ExploreDone, ExploreProgress, ExploreScope, ScanStatus } from '../../shared/types';
import { ExploreTree, type FlatTree } from './explore';
import { CANCEL_REQUESTED, type ExploreWorkerInput, type ExploreWorkerMessage } from './protocol';

export interface ExploreSink {
  progress(progress: ExploreProgress): void;
  done(done: ExploreDone): void;
}

export interface ExploreConfig {
  roots: Record<ExploreScope, string>;
  homePath: string;
  exclusions(): string[];
}

interface ActiveExplore {
  exploreId: string;
  scope: ExploreScope;
  worker: Worker;
  cancelFlag: Int32Array;
  sink: ExploreSink;
  startedAt: number;
  killTimer?: NodeJS.Timeout;
}

const FORCE_STOP_AFTER_MS = 500;

/** Builds the disk map in a worker and keeps the latest complete one for the interface. */
export class ExploreService {
  private active: ActiveExplore | null = null;
  private tree: ExploreTree | null = null;

  constructor(
    private readonly workerPath: string,
    private readonly config: ExploreConfig,
  ) {}

  get isRunning(): boolean {
    return this.active !== null;
  }

  /** The latest complete exploration; a cancelled or failed one leaves none. */
  get current(): ExploreTree | null {
    return this.tree;
  }

  start(scope: ExploreScope, sink: ExploreSink): string {
    if (this.active) throw new Error('Une exploration est déjà en cours');
    this.tree = null;
    const exploreId = randomUUID();
    const cancelBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const input: ExploreWorkerInput = {
      kind: 'explore',
      exploreId,
      rootPath: this.config.roots[scope],
      exclusions: this.config.exclusions(),
      cancelBuffer,
    };
    const worker = new Worker(this.workerPath, { workerData: input });
    const run: ActiveExplore = {
      exploreId,
      scope,
      worker,
      cancelFlag: new Int32Array(cancelBuffer),
      sink,
      startedAt: Date.now(),
    };
    this.active = run;

    worker.on('message', (message: ExploreWorkerMessage) => {
      if (this.active !== run) return;
      if (message.type === 'progress') sink.progress(message.progress);
      else this.finish(run, message.tree.stopped ? 'cancelled' : 'completed', message.tree);
    });
    worker.on('error', (error: Error) => this.finish(run, 'failed', undefined, error.message));
    worker.on('exit', () => {
      const cancelled = Atomics.load(run.cancelFlag, 0) === CANCEL_REQUESTED;
      this.finish(
        run,
        cancelled ? 'cancelled' : 'failed',
        undefined,
        cancelled ? undefined : 'Arrêt inattendu de l’exploration',
      );
    });
    return exploreId;
  }

  cancel(exploreId: string): void {
    const run = this.active;
    if (!run || run.exploreId !== exploreId) return;
    Atomics.store(run.cancelFlag, 0, CANCEL_REQUESTED);
    run.killTimer ??= setTimeout(() => {
      if (this.active !== run) return;
      void run.worker.terminate();
      this.finish(run, 'cancelled');
    }, FORCE_STOP_AFTER_MS);
  }

  dispose(): void {
    const run = this.active;
    if (!run) return;
    this.active = null;
    clearTimeout(run.killTimer);
    void run.worker.terminate();
  }

  private finish(run: ActiveExplore, status: ScanStatus, flat?: FlatTree, error?: string): void {
    if (this.active !== run) return;
    this.active = null;
    clearTimeout(run.killTimer);
    void run.worker.terminate();
    // A partial map would show wrong sizes: only a complete one is kept.
    const tree = status === 'completed' && flat ? new ExploreTree(flat) : null;
    this.tree = tree;
    run.sink.done({
      exploreId: run.exploreId,
      status,
      scope: run.scope,
      rootPath: this.config.roots[run.scope],
      homePath: this.config.homePath,
      sizeBytes: tree?.totalBytes ?? 0,
      fileCount: tree?.totalFiles ?? 0,
      deniedCount: flat?.deniedCount ?? 0,
      durationMs: Date.now() - run.startedAt,
      ...(error === undefined ? {} : { error }),
    });
  }
}
