import { Worker } from 'node:worker_threads';
import type { MeasureWorkerInput, MeasureWorkerMessage } from './protocol';

/** Measures the given paths in the scan worker, so the main process never walks a folder. */
export function measureInWorker(workerPath: string, paths: readonly string[]): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const input: MeasureWorkerInput = {
      kind: 'measure',
      paths: [...paths],
      cancelBuffer: new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
    };
    const worker = new Worker(workerPath, { workerData: input });
    worker.once('message', (message: MeasureWorkerMessage) => {
      resolve(message.sizes);
      void worker.terminate();
    });
    worker.once('error', reject);
    worker.once('exit', () => reject(new Error('Arrêt inattendu de la mesure')));
  });
}
