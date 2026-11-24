import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { createFakeHome, launchApp, type FakeHome } from './fixture';

let home: FakeHome;
let app: ElectronApplication;
let page: Page;

const startButton = () => page.getByRole('button', { name: /^(Lancer|Relancer) le scan$/ });

test.beforeAll(async () => {
  home = await createFakeHome();
  await home.file('Library/Caches/com.exemple.app/cache.db', 200_000);
  await home.file('Library/Logs/app.log', 8192);
  await home.file('Library/Keychains/login.keychain-db');
  await home.file('.Trash/ancien.txt');
  app = await launchApp(home);
  page = await app.firstWindow();
});

test.afterAll(async () => {
  await app.close();
  await home.cleanup();
});

test('le tableau de bord montre les catégories triées par taille et le graphique', async () => {
  await startButton().click();
  const summary = page.getByTestId('scan-summary');
  await expect(summary).toContainText('Scan terminé', { timeout: 20_000 });

  const cards = page.getByTestId('category-card');
  await expect(cards.and(page.locator('[data-category="user-caches"]'))).toContainText('1 élément');
  await expect(cards.and(page.locator('[data-category="user-logs"]'))).toBeVisible();
  await expect(cards.and(page.locator('[data-category="trash"]'))).toBeVisible();
  // brew --cache points to the real home, outside the test root: the category stays hidden.
  await expect(cards.and(page.locator('[data-category="homebrew-cache"]'))).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('Keychains');
  await expect(page.getByTestId('category-chart').locator('svg').first()).toBeVisible();

  const order = await cards.evaluateAll((nodes) =>
    nodes.map((n) => n.getAttribute('data-category')),
  );
  expect(order[0]).toBe('user-caches');
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
