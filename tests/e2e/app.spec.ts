import { expect, test, type ElectronApplication } from '@playwright/test';
import { createFakeHome, launchApp, type FakeHome } from './fixture';

let home: FakeHome;
let app: ElectronApplication;

test.beforeAll(async () => {
  home = await createFakeHome();
  app = await launchApp(home);
});

test.afterAll(async () => {
  await app.close();
  await home.cleanup();
});

test("la fenêtre s'ouvre depuis le protocole app://", async () => {
  const page = await app.firstWindow();
  await expect(page).toHaveTitle('MacSweep');
  expect(page.url()).toBe('app://macsweep/index.html');
});

test('les réglages de sécurité Electron sont actifs', async () => {
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    // Present at runtime but missing from Electron's type definitions.
    const contents = BrowserWindow.getAllWindows()[0]?.webContents as unknown as {
      getLastWebPreferences(): Record<string, unknown>;
    };
    const p = contents.getLastWebPreferences();
    return {
      contextIsolation: p?.contextIsolation,
      nodeIntegration: p?.nodeIntegration,
      sandbox: p?.sandbox,
      webSecurity: p?.webSecurity,
    };
  });
  expect(prefs).toEqual({
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
  });
});

test("l'interface n'a pas accès à Node", async () => {
  const page = await app.firstWindow();
  const exposed = await page.evaluate(() => ({
    require: typeof (globalThis as Record<string, unknown>).require,
    process: typeof (globalThis as Record<string, unknown>).process,
    api: Object.keys(window.macsweep),
  }));
  expect(exposed).toEqual({
    require: 'undefined',
    process: 'undefined',
    api: ['disk', 'scan', 'fs', 'clean', 'trash', 'settings', 'history', 'dialog', 'explore'],
  });
});

test('la CSP stricte est appliquée et le réseau est bloqué', async () => {
  const page = await app.firstWindow();
  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(csp).toContain("connect-src 'none'");
  const fetched = await page.evaluate(async () => {
    try {
      await fetch('https://example.com/');
      return 'réussi';
    } catch {
      return 'bloqué';
    }
  });
  expect(fetched).toBe('bloqué');
});

test("le tableau de bord affiche l'espace disque", async () => {
  const page = await app.firstWindow();
  await expect(page.getByTestId('disk-gauge')).toBeVisible();
  await expect(page.getByRole('meter')).toHaveAttribute('aria-valuenow', /\d+/);
});

test('la navigation latérale fonctionne au clavier', async () => {
  const page = await app.firstWindow();
  const nav = page.getByRole('navigation', { name: 'Navigation principale' });
  await nav.getByRole('button', { name: 'Réglages' }).focus();
  await page.keyboard.press('Enter');
  await expect(nav.getByRole('button', { name: 'Réglages' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('heading', { level: 1, name: 'Réglages' })).toBeVisible();
});
