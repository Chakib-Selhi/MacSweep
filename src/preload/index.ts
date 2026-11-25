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
  clean: {
    execute: (paths, request) => invoke('clean:execute', paths, request),
    onProgress: (listener) => subscribe('clean:progress', listener),
  },
  trash: {
    empty: (confirmation) => invoke('trash:empty', confirmation),
  },
  settings: {
    get: () => invoke('settings:get'),
    set: (patch) => invoke('settings:set', patch),
  },
  history: {
    list: () => invoke('history:list'),
  },
  dialog: {
    pickFolder: () => invoke('dialog:pickFolder'),
  },
  explore: {
    start: (scope) => invoke('explore:start', scope),
    cancel: (exploreId) => invoke('explore:cancel', exploreId),
    list: (path) => invoke('explore:list', path),
    trash: (paths, request) => invoke('explore:trash', paths, request),
    onProgress: (listener) => subscribe('explore:progress', listener),
    onDone: (listener) => subscribe('explore:done', listener),
  },
};

contextBridge.exposeInMainWorld('macsweep', api);
