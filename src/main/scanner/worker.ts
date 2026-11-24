import { parentPort, workerData } from 'node:worker_threads';
import { CANCEL_REQUESTED, type WorkerInput, type WorkerMessage } from './protocol';
import { runScan } from './scan';
import { createToolDeps } from './tools';

const port = parentPort;
if (!port) throw new Error('Ce module doit tourner dans un worker_thread');

const { config, cancelBuffer } = workerData as WorkerInput;
const cancelFlag = new Int32Array(cancelBuffer);
const send = (message: WorkerMessage) => port.postMessage(message);

void runScan(config, createToolDeps(config.home), {
  emitProgress: (progress) => send({ type: 'progress', progress }),
  shouldStop: () => Atomics.load(cancelFlag, 0) === CANCEL_REQUESTED,
  now: () => Date.now(),
}).then((done) => send({ type: 'done', done }));
