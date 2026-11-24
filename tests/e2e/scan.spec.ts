import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createFakeHome, launchApp, type FakeHome } from './fixture';

let home: FakeHome;
let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  home = await createFakeHome();
  await home.file('Library/Caches/com.exemple.app/cache.db', 200_000);
  await home.file('Library/Logs/app.log', 8192);
  await home.file('Library/Keychains/login.keychain-db');
  await home.file('.Trash/ancien.txt');
  // Enough files for a scan to still be running when it is cancelled.
  for (let d = 0; d < 60; d += 1) {
    const dir = path.join(home.root, 'Library/Caches/gros', `d${d}`);
    await mkdir(dir, { recursive: true });
    await Promise.all(
      Array.from({ length: 500 }, (_, f) => writeFile(path.join(dir, `f${f}`), '')),
    );
  }
  app = await launchApp(home);
  page = await app.firstWindow();
});

test.afterAll(async () => {
  await app.close();
  await home.cleanup();
});

test('le scan trouve les catégories de la racine de test et ignore la liste noire', async () => {
  await page.getByRole('button', { name: 'Lancer le scan' }).click();
  const results = page.getByTestId('scan-results');
  await expect(results).toBeVisible({ timeout: 20_000 });
  await expect(results.getByRole('status')).toContainText('Scan terminé');
  await expect(results.locator('[data-category="user-caches"]')).toContainText('2 éléments');
  await expect(results.locator('[data-category="user-logs"]')).toBeVisible();
  await expect(results.locator('[data-category="trash"]')).toBeVisible();
  // brew --cache points to the real home, outside the test root: the category stays hidden.
  await expect(results.locator('[data-category="homebrew-cache"]')).toHaveCount(0);
  await expect(results).not.toContainText('Keychains');
});

test('l’annulation arrête le scan en moins d’une seconde', async () => {
  await page.getByRole('button', { name: 'Lancer le scan' }).click();
  await page.getByRole('button', { name: 'Annuler' }).click();
  const clickedAt = Date.now();
  await expect(page.getByTestId('scan-results').getByRole('status')).toContainText('Scan annulé', {
    timeout: 2000,
  });
  expect(Date.now() - clickedAt).toBeLessThan(1000);
});

test('les appels IPC forgés depuis la page sont refusés', async () => {
  const outcomes = await page.evaluate(async () => {
    const api = window.macsweep as unknown as {
      fs: { reveal(p: unknown): Promise<void> };
      scan: { start(r: unknown): Promise<string>; cancel(id: unknown): Promise<void> };
    };
    const attempt = (call: () => Promise<unknown>) =>
      call().then(
        () => 'accepté',
        () => 'refusé',
      );
    return {
      revealOutside: await attempt(() => api.fs.reveal('/etc/hosts')),
      revealRelative: await attempt(() => api.fs.reveal('../../etc/hosts')),
      revealNumber: await attempt(() => api.fs.reveal(42)),
      startWithRoot: await attempt(() => api.scan.start({ home: '/' })),
      startUnknownCategory: await attempt(() => api.scan.start({ categories: ['System'] })),
      cancelBadId: await attempt(() => api.scan.cancel('../x')),
    };
  });
  expect(outcomes).toEqual({
    revealOutside: 'refusé',
    revealRelative: 'refusé',
    revealNumber: 'refusé',
    startWithRoot: 'refusé',
    startUnknownCategory: 'refusé',
    cancelBadId: 'refusé',
  });
});
