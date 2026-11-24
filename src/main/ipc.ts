import { ipcMain, shell, type WebContents } from 'electron';
import type {
  EventChannel,
  EventContract,
  InvokeArgs,
  InvokeChannel,
  InvokeResult,
} from '../shared/types';
import { readDiskInfo } from './disk';
import {
  expectNoArgs,
  expectScanId,
  expectSingleString,
  parseScanArgs,
  type ArgsParser,
} from './ipc-validation';
import { isTrustedSenderUrl } from './origins';
import { annotateOpenApps, listRunningApps } from './running-apps';
import type { Guard } from './safety/guard';
import type { ScanService } from './scanner/service';
import type { ToolRunner } from './scanner/tools';

interface IpcDeps {
  devServerUrl: string | undefined;
  guard: Guard;
  scans: ScanService;
  runTool: ToolRunner;
}

function send<C extends EventChannel>(target: WebContents, channel: C, payload: EventContract[C]) {
  if (!target.isDestroyed()) target.send(channel, payload);
}

export function registerIpcHandlers({ devServerUrl, guard, scans, runTool }: IpcDeps): void {
  function handle<C extends InvokeChannel>(
    channel: C,
    parseArgs: ArgsParser<C>,
    handler: (sender: WebContents, ...args: InvokeArgs<C>) => Promise<InvokeResult<C>>,
  ): void {
    ipcMain.handle(channel, async (event, ...raw: unknown[]) => {
      const frame = event.senderFrame;
      if (!frame || frame.parent !== null || !isTrustedSenderUrl(frame.url, devServerUrl)) {
        throw new Error('Expéditeur IPC refusé');
      }
      return handler(event.sender, ...parseArgs(raw));
    });
  }

  handle('disk:info', expectNoArgs, () => readDiskInfo(guard.root));

  handle('scan:start', parseScanArgs, (sender, request) =>
    Promise.resolve(
      scans.start(request?.categories ?? [], {
        progress: (progress) => send(sender, 'scan:progress', progress),
        // Rule 6: items of a running app are flagged so the review leaves them unchecked.
        done: (done) => {
          void listRunningApps(runTool)
            .then((apps) => annotateOpenApps(done, apps))
            .catch(() => done)
            .then((annotated) => send(sender, 'scan:done', annotated));
        },
      }),
    ),
  );

  handle('scan:cancel', expectScanId, (_sender, scanId) => {
    scans.cancel(scanId);
    return Promise.resolve();
  });

  handle('fs:reveal', expectSingleString, async (_sender, input) => {
    const result = await guard.checkReadable(input);
    if (!result.ok) throw new Error(`Chemin refusé (${result.reason})`);
    shell.showItemInFolder(result.path);
  });
}
