import { app, BrowserWindow, dialog, nativeTheme, protocol, session, type Session } from 'electron';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DEV_CSP, PROD_CSP } from './csp';
import { registerIpcHandlers } from './ipc';
import {
  APP_ENTRY_URL,
  APP_SCHEME,
  isAllowedRequestUrl,
  mimeTypeFor,
  resolveRendererFile,
} from './origins';
import { createGuard } from './safety/guard';
import { pickRoot, TEST_ROOT_ENV } from './safety/root';
import { ScanService } from './scanner/service';
import { createToolDeps } from './scanner/tools';

// In a production build Forge replaces this constant with `undefined`.
const devServerUrl: string | undefined = MAIN_WINDOW_VITE_DEV_SERVER_URL || undefined;
const rendererDir = path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`);
const scanWorkerPath = path.join(__dirname, 'scan-worker.cjs');

// Until M5 brings the settings screen, the PRD defaults apply.
const DEFAULT_SCAN_SETTINGS = {
  projectDirs: [] as string[],
  exclusions: [] as string[],
  nodeModulesMinAgeDays: 30,
  downloadsMinAgeDays: 14,
};

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true } },
]);

// Test runs get their own data folder: they never share the lock, settings or history of
// the instance the user may have open.
if (!app.isPackaged && process.env[TEST_ROOT_ENV]) {
  app.setPath('userData', path.join(os.tmpdir(), `macsweep-test-userdata-${process.pid}`));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function registerAppProtocol(): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const filePath = resolveRendererFile(rendererDir, request.url);
    if (!filePath) return new Response('Not found', { status: 404 });

    // Read directly rather than net.fetch, so the session's network filter stays closed to file://.
    try {
      const body = await readFile(filePath);
      return new Response(body, {
        headers: {
          'Content-Type': mimeTypeFor(filePath),
          'Content-Security-Policy': PROD_CSP,
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

function hardenSession(ses: Session): void {
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isAllowedRequestUrl(details.url, devServerUrl) });
  });
  if (devServerUrl) {
    ses.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [DEV_CSP] },
      });
    });
  }
}

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event) => event.preventDefault());
  contents.on('will-redirect', (event) => event.preventDefault());
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 880,
    minHeight: 560,
    show: false,
    title: 'MacSweep',
    titleBarStyle: 'hiddenInset',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });

  window.once('ready-to-show', () => window.show());
  void window.loadURL(devServerUrl ?? APP_ENTRY_URL);
  return window;
}

async function start(): Promise<void> {
  const root = await pickRoot({
    homedir: os.homedir(),
    tmpdir: os.tmpdir(),
    override: process.env[TEST_ROOT_ENV],
    isPackaged: app.isPackaged,
  });
  const guard = await createGuard({ root });
  const scans = new ScanService(scanWorkerPath, () => ({
    home: guard.root,
    ...DEFAULT_SCAN_SETTINGS,
  }));
  app.on('before-quit', () => scans.dispose());

  hardenSession(session.defaultSession);
  registerAppProtocol();
  registerIpcHandlers({ devServerUrl, guard, scans, runTool: createToolDeps(guard.root).run });
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
}

void app
  .whenReady()
  .then(start)
  .catch((error: unknown) => {
    dialog.showErrorBox('MacSweep ne peut pas démarrer', String(error));
    app.exit(1);
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
