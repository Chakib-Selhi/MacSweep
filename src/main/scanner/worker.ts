import { parentPort, workerData } from 'node:worker_threads';
import { buildExploreTree, diskSkipper } from './explore';
import {
  CANCEL_REQUESTED,
  type ExploreWorkerInput,
  type ExploreWorkerMessage,
  type MeasureWorkerInput,
  type MeasureWorkerMessage,
  type WorkerInput,
  type WorkerMessage,
} from './protocol';
import { runScan } from './scan';
import { createToolDeps } from './tools';
import { Walker } from './walk';

const port = parentPort;
if (!port) throw new Error('Ce module doit tourner dans un worker_thread');

const PROGRESS_INTERVAL_MS = 100;
const input = workerData as WorkerInput | ExploreWorkerInput | MeasureWorkerInput;
const cancelFlag = new Int32Array(input.cancelBuffer);
const shouldStop = () => Atomics.load(cancelFlag, 0) === CANCEL_REQUESTED;

if ('kind' in input && input.kind === 'measure') {
  const walker = new Walker({ isExcluded: () => false, shouldStop, onTick: () => undefined });
  const sizes = input.paths.map((target) => walker.measure(target)?.bytes ?? 0);
  const message: MeasureWorkerMessage = { type: 'measured', sizes };
  port.postMessage(message);
} else if ('kind' in input && input.kind === 'explore') {
  const send = (message: ExploreWorkerMessage, transfer: ArrayBuffer[] = []) =>
    port.postMessage(message, transfer);
  let lastProgress = 0;
  const tree = buildExploreTree({
    rootPath: input.rootPath,
    skip: diskSkipper(input.rootPath, input.exclusions),
    shouldStop,
    onTick: (currentDir, filesVisited, bytesFound) => {
      const now = Date.now();
      if (now - lastProgress < PROGRESS_INTERVAL_MS) return;
      lastProgress = now;
      send({
        type: 'progress',
        progress: { exploreId: input.exploreId, filesVisited, bytesFound, currentDir },
      });
    },
  });
  send({ type: 'done', tree }, [
    tree.parents.buffer,
    tree.kinds.buffer,
    tree.bytes.buffer,
    tree.files.buffer,
    tree.denied.buffer,
  ] as ArrayBuffer[]);
} else {
  const { config } = input;
  const send = (message: WorkerMessage) => port.postMessage(message);
  void runScan(config, createToolDeps(config.home), {
    emitProgress: (progress) => send({ type: 'progress', progress }),
    shouldStop,
    now: () => Date.now(),
  }).then((done) => send({ type: 'done', done }));
}
