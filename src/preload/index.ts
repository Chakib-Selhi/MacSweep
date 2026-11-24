import { contextBridge, ipcRenderer } from 'electron';
import type {
  EventChannel,
  EventContract,
  InvokeArgs,
  InvokeChannel,
  InvokeResult,
  MacSweepApi,
  Unsubscribe,
} from '../shared/types';

function invoke<C extends InvokeChannel>(
  channel: C,
  ...args: InvokeArgs<C>
): Promise<InvokeResult<C>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<InvokeResult<C>>;
}

// The IPC event object is never handed to the page: it would expose ipcRenderer.
function subscribe<C extends EventChannel>(
  channel: C,
  listener: (payload: EventContract[C]) => void,
): Unsubscribe {
  const wrapped = (_event: unknown, payload: EventContract[C]) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

const api: MacSweepApi = {
  disk: {
    info: () => invoke('disk:info'),
  },
  scan: {
    start: (request) => invoke('scan:start', request),
    cancel: (scanId) => invoke('scan:cancel', scanId),
    onProgress: (listener) => subscribe('scan:progress', listener),
    onDone: (listener) => subscribe('scan:done', listener),
  },
  fs: {
    reveal: (path) => invoke('fs:reveal', path),
  },
};

contextBridge.exposeInMainWorld('macsweep', api);
