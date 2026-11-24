import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createFakeHome, launchApp, type FakeHome } from './fixture';

const ITEM_COUNT = 100_000;

let home: FakeHome;
let app: ElectronApplication;
let page: Page;

test.describe.configure({ timeout: 180_000 });

test.beforeAll(async () => {
  home = await createFakeHome();
  const caches = path.join(home.root, 'Library/Caches');
  await mkdir(caches, { recursive: true });
  for (let start = 0; start < ITEM_COUNT; start += 2000) {
    await Promise.all(
      Array.from({ length: 2000 }, (_, i) => writeFile(path.join(caches, `f${start + i}`), '')),
    );
  }
  app = await launchApp(home);
  page = await app.firstWindow();
});

test.afterAll(async () => {
  await app.close();
  await home.cleanup();
});

test('la progression s’affiche en direct, et l’annulation arrête le scan en moins d’une seconde', async () => {
  await page.getByRole('button', { name: 'Lancer le scan' }).click();
  await expect(page.getByTestId('scan-progress')).toContainText('Caches utilisateur');
  await page.getByRole('button', { name: 'Annuler' }).click();
  const clickedAt = Date.now();
  await expect(page.getByTestId('scan-summary')).toContainText('Scan annulé', { timeout: 2000 });
  expect(Date.now() - clickedAt).toBeLessThan(1000);
});

test('100 000 lignes : seules les lignes visibles sont dans le DOM et la liste reste réactive', async () => {
  await page.getByRole('button', { name: 'Relancer le scan' }).click();
  await expect(page.getByTestId('scan-summary')).toContainText('Scan terminé', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Revoir et nettoyer' }).click();
  await expect(page.getByTestId('selection-bar')).toContainText('100 000 sélectionnés');

  await page.getByRole('button', { name: /Afficher les éléments de Caches utilisateur/ }).click();
  const rendered = await page.getByTestId('review-item').count();
  expect(rendered).toBeGreaterThan(0);
  expect(rendered).toBeLessThan(100);

  const list = page.getByTestId('review-list');
  const startedAt = Date.now();
  await list.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect
    .poll(async () =>
      Math.max(
        ...(await page
          .locator('[data-testid="review-list"] [data-index]')
          .evaluateAll((nodes) => nodes.map((n) => Number(n.getAttribute('data-index'))))),
      ),
    )
    .toBe(ITEM_COUNT);
  expect(Date.now() - startedAt).toBeLessThan(1000);

  const last = page.getByTestId('review-item').last();
  await last.getByRole('checkbox').uncheck();
  await expect(page.getByTestId('selection-bar')).toContainText('99 999 sélectionnés', {
    timeout: 1000,
  });
});
