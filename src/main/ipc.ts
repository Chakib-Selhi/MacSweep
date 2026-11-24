import { BrowserWindow, dialog, ipcMain, shell, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import type { CategoryId } from '../shared/categories';
import type {
  EventChannel,
  EventContract,
  InvokeArgs,
  InvokeChannel,
  InvokeResult,
} from '../shared/types';
import { cleanPaths } from './cleaner';
import { readDiskInfo } from './disk';
import {
  expectNoArgs,
  expectScanId,
  expectSingleString,
  parseCleanArgs,
  parseScanArgs,
  parseSettingsPatch,
  type ArgsParser,
} from './ipc-validation';
import type { Journal } from './journal';
import { isTrustedSenderUrl } from './origins';
import { annotateOpenApps, listRunningApps } from './running-apps';
import type { Guard } from './safety/guard';
import type { ScanRegistry } from './scan-registry';
import type { ScanService } from './scanner/service';
import type { ToolRunner } from './scanner/tools';
import type { AppStore } from './store';
import { emptyTrash } from './trash-empty';
import type { TrashMover } from './trash-mover';

interface IpcDeps {
  devServerUrl: string | undefined;
  guard: Guard;
  scans: ScanService;
  registry: ScanRegistry;
  store: AppStore;
  journal: Journal;
  moveToTrash: TrashMover;
  runTool: ToolRunner;
}

function send<C extends EventChannel>(target: WebContents, channel: C, payload: EventContract[C]) {
  if (!target.isDestroyed()) target.send(channel, payload);
}

export function registerIpcHandlers(deps: IpcDeps): void {
  const { devServerUrl, guard, scans, registry, store, journal, moveToTrash, runTool } = deps;
  let busyCleaning = false;

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

  /** One disk-changing operation at a time, never during a scan. */
  async function exclusive<T>(task: () => Promise<T>): Promise<T> {
    if (scans.isRunning) throw new Error('Un scan est en cours');
    if (busyCleaning) throw new Error('Un nettoyage est déjà en cours');
    busyCleaning = true;
    try {
      return await task();
    } finally {
      busyCleaning = false;
    }
  }

  handle('disk:info', expectNoArgs, () => readDiskInfo(guard.root));

  handle('scan:start', parseScanArgs, (sender, request) => {
    if (busyCleaning) return Promise.reject(new Error('Un nettoyage est en cours'));
    return Promise.resolve(
      scans.start(request?.categories ?? [], {
        progress: (progress) => send(sender, 'scan:progress', progress),
        // Rule 6: items of a running app are flagged so the review leaves them unchecked.
        done: (done) => {
          void listRunningApps(runTool)
            .then((apps) => annotateOpenApps(done, apps))
            .catch(() => done)
            .then((annotated) => {
              registry.replace(annotated);
              send(sender, 'scan:done', annotated);
            });
        },
      }),
    );
  });

  handle('scan:cancel', expectScanId, (_sender, scanId) => {
    scans.cancel(scanId);
    return Promise.resolve();
  });

  handle('fs:reveal', expectSingleString, async (_sender, input) => {
    const result = await guard.checkReadable(input);
    if (!result.ok) throw new Error(`Chemin refusé (${result.reason})`);
    shell.showItemInFolder(result.path);
  });

  handle('clean:execute', parseCleanArgs, (sender, paths, request) =>
    exclusive(async () => {
      // The saved setting wins: a request cannot turn simulation off on its own.
      const dryRun = store.getSettings().dryRun || request.dryRun;
      const options = { ...request, dryRun };
      const report = await cleanPaths(paths, options, {
        guard,
        registry,
        moveToTrash,
        listRunningApps: () => listRunningApps(runTool),
        journal,
        exclusions: store.getSettings().exclusions,
        onProgress: (progress) => send(sender, 'clean:progress', progress),
        now: () => Date.now(),
      });
      if (!report.dryRun && report.moved.length > 0) {
        store.addHistory({
          id: randomUUID(),
          dateMs: Date.now(),
          kind: 'clean',
          categories: [...new Set<CategoryId>(report.moved.map((item) => item.categoryId))],
          bytesFreed: report.bytesFreed,
          movedCount: report.moved.length,
          failedCount: report.failed.length,
        });
      }
      return report;
    }),
  );

  handle('trash:empty', expectSingleString, (_sender, confirmation) =>
    exclusive(async () => {
      const report = await emptyTrash({
        root: guard.root,
        confirmation,
        dryRun: store.getSettings().dryRun,
        journal,
      });
      if (!report.dryRun && report.deletedCount > 0) {
        store.addHistory({
          id: randomUUID(),
          dateMs: Date.now(),
          kind: 'empty-trash',
          categories: ['trash'],
          bytesFreed: report.bytesFreed,
          movedCount: report.deletedCount,
          failedCount: report.failed.length,
        });
      }
      return report;
    }),
  );

  handle('settings:get', expectNoArgs, () => Promise.resolve(store.getSettings()));
  /** Every saved folder must be readable and inside the home folder; stored by its real path. */
  async function checkFolders(folders: readonly string[]): Promise<string[]> {
    const checked = new Set<string>();
    for (const folder of folders) {
      const result = await guard.checkReadable(folder);
      if (!result.ok) throw new Error(`Dossier refusé (${result.reason}) : ${folder}`);
      checked.add(result.path);
    }
    return [...checked];
  }

  handle('settings:set', parseSettingsPatch, async (_sender, patch) => {
    const checked = { ...patch };
    for (const key of ['exclusions', 'projectDirs', 'duplicateDirs'] as const) {
      const folders = patch[key];
      if (folders) checked[key] = await checkFolders(folders);
    }
    return store.updateSettings(checked);
  });

  handle('history:list', expectNoArgs, () => Promise.resolve(store.listHistory()));

  handle('dialog:pickFolder', expectNoArgs, async (sender) => {
    const window = BrowserWindow.fromWebContents(sender);
    const options = {
      properties: ['openDirectory' as const],
      defaultPath: guard.root,
      buttonLabel: 'Choisir',
    };
    const picked = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    const [folder] = picked.filePaths;
    if (picked.canceled || !folder) return null;
    const result = await guard.checkReadable(folder);
    if (!result.ok) throw new Error('Choisis un dossier situé dans ton dossier utilisateur');
    return result.path;
  });
}
