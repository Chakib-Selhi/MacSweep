import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createFakeHome, launchApp, type FakeHome } from './fixture';

let home: FakeHome;
let app: ElectronApplication;
let page: Page;
let root: string;
let disk: string;

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );
const entry = (name: string) =>
  page.locator('[data-testid="explore-entry"]', { hasText: new RegExp(`(^|\\s)${name}`) });
const bar = () => page.getByTestId('selection-bar');
const cleanDialog = () => page.getByTestId('clean-dialog');

async function explore(scope: 'Mon dossier' | 'Tout le disque') {
  await page.getByLabel(scope).check();
  await page.getByRole('button', { name: /^(Explorer|Relancer)$/ }).click();
  await expect(page.getByTestId('explore-status')).toContainText('Exploration terminée', {
    timeout: 20_000,
  });
}

async function forgedTrash(paths: string[]): Promise<string[]> {
  return page.evaluate(async (list) => {
    const report = await window.macsweep.explore.trash(list, {
      dryRun: false,
      confirmProtected: true,
      confirmHighRisk: true,
    });
    return report.failed.map((failure) => failure.reason);
  }, paths);
}

test.beforeAll(async () => {
  home = await createFakeHome();
  await home.file('Movies/film.mp4', 3_000_000);
  await home.file('Movies/court.mov', 200_000);
  await home.file('Library/Caches/com.app/cache.db', 1_000_000);
  await home.file('.config/outil/reglages.json', 10_000);
  await mkdir(path.join(home.disk, 'autre'), { recursive: true });
  await writeFile(path.join(home.disk, 'autre/systeme.bin'), Buffer.alloc(500_000, 3));
  root = await realpath(home.root);
  disk = await realpath(home.disk);

  app = await launchApp(home);
  page = await app.firstWindow();
  await page
    .getByRole('navigation', { name: 'Navigation principale' })
    .getByRole('button', { name: 'Exploration' })
    .click();
});

test.afterAll(async () => {
  await app.close();
  await home.cleanup();
});

test('la carte du dossier utilisateur montre les tailles, du plus gros au plus petit', async () => {
  await explore('Mon dossier');
  await expect(page.getByTestId('explore-map')).toBeVisible();
  const rows = await page.getByTestId('explore-entry').allTextContents();
  expect(rows[0]).toContain('Movies');
  await expect(entry('Library').getByRole('checkbox')).toBeDisabled();
  await expect(entry('Library')).toContainText('Lecture seule');
  await expect(entry('.config').getByRole('checkbox')).toBeDisabled();
  await expect(entry('Movies').getByRole('checkbox')).toBeEnabled();
});

test('on entre dans un dossier et on met un fichier à la Corbeille', async () => {
  await page.getByRole('button', { name: 'Ouvrir Movies' }).click();
  await expect(page.getByRole('navigation', { name: 'Chemin' })).toContainText('Movies');
  await entry('film.mp4').getByRole('checkbox').check();
  await expect(bar()).toContainText('1 sélectionné');
  await bar()
    .getByRole('checkbox', { name: /Mode simulation/ })
    .uncheck();
  await bar().getByRole('button', { name: 'Nettoyer…' }).click();
  const confirm = cleanDialog().getByRole('button', { name: 'Mettre à la Corbeille' });
  await expect(confirm).toBeDisabled();
  await cleanDialog()
    .getByRole('checkbox', { name: /risque élevé/ })
    .check();
  await confirm.click();
  await expect(page.getByTestId('clean-report')).toContainText('mis à la Corbeille');
  await cleanDialog().getByRole('button', { name: 'Fermer' }).click();

  expect(await exists(path.join(root, 'Movies/film.mp4'))).toBe(false);
  expect(await readdir(path.join(root, '.Trash'))).toContain('film.mp4');
  await expect(entry('film.mp4')).toHaveCount(0);
  await expect(entry('court.mov')).toHaveCount(1);
});

test('le processus principal refuse ce que la carte montre en lecture seule', async () => {
  const reasons = await forgedTrash([
    path.join(root, 'Library/Caches/com.app'),
    path.join(root, '.config/outil'),
    path.join(root, 'Movies/inconnu.mp4'),
    root,
  ]);
  expect(reasons).toEqual(['read-only', 'read-only', 'not-found', 'is-root']);
  expect(await exists(path.join(root, 'Library/Caches/com.app/cache.db'))).toBe(true);
  const listing = await page.evaluate(() =>
    window.macsweep.explore.list('/etc').then(
      () => 'accepté',
      () => 'refusé',
    ),
  );
  expect(listing).toBe('refusé');
});

test('tout le disque est visible, mais rien hors du dossier utilisateur n’est supprimable', async () => {
  await explore('Tout le disque');
  await expect(entry('autre')).toContainText('Lecture seule');
  await expect(entry('home').getByRole('checkbox')).toBeDisabled();
  await page.getByRole('button', { name: 'Ouvrir autre' }).click();
  await expect(entry('systeme.bin').getByRole('checkbox')).toBeDisabled();

  const reasons = await forgedTrash([path.join(disk, 'autre/systeme.bin')]);
  expect(reasons).toEqual(['outside-root']);
  expect(await exists(path.join(disk, 'autre/systeme.bin'))).toBe(true);
});
