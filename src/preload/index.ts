import { contextBridge, ipcRenderer } from 'electron';
import type { InvokeArgs, InvokeChannel, InvokeResult, MacSweepApi } from '../shared/types';

function invoke<C extends InvokeChannel>(
  channel: C,
  ...args: InvokeArgs<C>
): Promise<InvokeResult<C>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<InvokeResult<C>>;
}

const api: MacSweepApi = {
  disk: {
    info: () => invoke('disk:info'),
  },
};

contextBridge.exposeInMainWorld('macsweep', api);
