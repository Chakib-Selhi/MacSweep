import { ipcMain } from 'electron';
import os from 'node:os';
import type { InvokeArgs, InvokeChannel, InvokeResult } from '../shared/types';
import { readDiskInfo } from './disk';
import { expectNoArgs, type ArgsParser } from './ipc-validation';
import { isTrustedSenderUrl } from './origins';

export function registerIpcHandlers(devServerUrl: string | undefined): void {
  function handle<C extends InvokeChannel>(
    channel: C,
    parseArgs: ArgsParser<C>,
    handler: (...args: InvokeArgs<C>) => Promise<InvokeResult<C>>,
  ): void {
    ipcMain.handle(channel, async (event, ...raw: unknown[]) => {
      const frame = event.senderFrame;
      if (!frame || frame.parent !== null || !isTrustedSenderUrl(frame.url, devServerUrl)) {
        throw new Error('Expéditeur IPC refusé');
      }
      return handler(...parseArgs(raw));
    });
  }

  handle('disk:info', expectNoArgs, () => readDiskInfo(os.homedir()));
}
