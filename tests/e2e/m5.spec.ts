import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, readdir, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createFakeHome, launchApp, type FakeHome } from './fixture';

let home: FakeHome;
let app: ElectronApplication;
let page: Page;

const at = (...parts: string[]) => path.join(home.root, ...parts);
const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );
const nav = (name: string) =>
  page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('button', { name });
const bar = () => page.getByTestId('selection-bar');
const cleanDialog = () => page.getByTestId('clean-dialog');

async function settingsSet(patch: Record<string, unknown>): Promise<string> {
  return page.evaluate(
    (p) =>
      (window.macsweep.settings.set as (x: unknown) => Promise<unknown>)(p).then(
        () => 'accepté',
        () => 'refusé',
      ),
    patch,
  );
}

async function rescan() {
  await nav('Tableau de bord').click();
  await page.getByRole('button', { name: /^(Lancer|Relancer) le scan$/ }).click();
  await expect(page.getByTestId('scan-summary')).toContainText('Scan terminé', { timeout: 20_000 });
}

test.beforeAll(async () => {
  home = await createFakeHome();
  await home.file('Movies/film.mp4', 3_000_000);
  await home.file('Documents/rapport.zip', 2_000_000);
  await home.file('Library/Containers/com.docker.docker/Data/vms/0/Docker.raw', 8192);
  const same = Buffer.alloc(50_000, 9);
  await mkdir(at('Documents'), { recursive: true });
  await mkdir(at('Downloads'), { recursive: true });
  await writeFile(at('Documents/original.bin'), same);
  const old = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  await utimes(at('Documents/original.bin'), old, old);
  await writeFile(at('Downloads/copie.bin'), same);
  await mkdir(at('Archives'), { recursive: true });

  app = await launchApp(home);
  page = await app.firstWindow();
});

test.afterAll(async () => {
  await app.close();
  await home.cleanup();
});

test('les réglages valident chaque dossier et chaque valeur', async () => {
  expect(await settingsSet({ exclusions: ['/etc'] })).toBe('refusé');
  expect(await settingsSet({ duplicateDirs: [at('nexiste-pas')] })).toBe('refusé');
  expect(await settingsSet({ largeFileThresholdBytes: 12 })).toBe('refusé');
  expect(await settingsSet({ dryRun: false, root: '/' })).toBe('refusé');
  expect(
    await settingsSet({
      largeFileThresholdBytes: 1_000_000,
      duplicateDirs: [at('Documents'), at('Downloads')],
      duplicateMinBytes: 1024,
      exclusions: [at('Archives')],
    }),
  ).toBe('accepté');
});

test('l’écran Réglages affiche et modifie les réglages', async () => {
  await nav('Réglages').click();
  await expect(page.getByTestId('folders-exclusions')).toContainText('Archives');
  await page.getByLabel('Seuil des gros fichiers').selectOption({ label: '100 Mo' });
  await expect(page.getByTestId('settings-status')).toContainText('Enregistré');
  await page
    .getByTestId('folders-exclusions')
    .getByRole('button', { name: /Retirer/ })
    .click();
  await expect(page.getByTestId('folders-exclusions')).toContainText('Aucun dossier.');
  const settings = await page.evaluate(() => window.macsweep.settings.get());
  expect(settings).toMatchObject({ largeFileThresholdBytes: 100_000_000, exclusions: [] });
  // Back to a threshold the fixture files reach.
  expect(await settingsSet({ largeFileThresholdBytes: 1_000_000 })).toBe('accepté');
});

test('le tableau de bord mène aux gros fichiers, filtrables par type', async () => {
  await rescan();
  await page
    .locator('[data-testid="category-card"][data-category="large-files"]')
    .getByRole('button', { name: /Voir/ })
    .click();
  await expect(page.getByTestId('large-file')).toHaveCount(2);
  await page.getByRole('button', { name: 'Vidéos' }).click();
  await expect(page.getByTestId('large-file')).toHaveCount(1);
  await expect(page.getByTestId('large-file')).toContainText('film.mp4');
  await page.getByRole('button', { name: 'Tous' }).click();
  await expect(
    page.locator('[data-testid="large-file"]', { hasText: 'rapport.zip' }),
  ).toContainText('Documents, Bureau ou Images');
});

test('nettoyer un gros fichier protégé exige deux confirmations', async () => {
  for (const name of ['film.mp4', 'rapport.zip']) {
    await page
      .locator('[data-testid="large-file"]', { hasText: name })
      .getByRole('checkbox')
      .check();
  }
  await expect(bar()).toContainText('2 sélectionnés');
  await bar()
    .getByRole('checkbox', { name: /Mode simulation/ })
    .uncheck();
  await bar().getByRole('button', { name: 'Nettoyer…' }).click();

  const confirm = cleanDialog().getByRole('button', { name: 'Mettre à la Corbeille' });
  await expect(confirm).toBeDisabled();
  await cleanDialog()
    .getByRole('checkbox', { name: /Documents, Bureau ou Images/ })
    .check();
  await expect(confirm).toBeDisabled();
  await cleanDialog()
    .getByRole('checkbox', { name: /risque élevé/ })
    .check();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.getByTestId('clean-report')).toContainText('mis à la Corbeille');
  await cleanDialog().getByRole('button', { name: 'Fermer' }).click();

  expect(await exists(at('Movies/film.mp4'))).toBe(false);
  expect(await exists(at('Documents/rapport.zip'))).toBe(false);
  expect(await readdir(at('.Trash'))).toEqual(expect.arrayContaining(['film.mp4', 'rapport.zip']));
});

test('les doublons gardent l’original verrouillé, même face à un appel forgé', async () => {
  await rescan();
  const card = page.locator('[data-testid="category-card"][data-category="duplicates"]');
  await expect(card).toContainText('1 groupe de doublons');
  await card.getByRole('button', { name: /Voir/ }).click();

  const original = page.locator('[data-testid="duplicate-file"]', { hasText: 'original.bin' });
  await expect(original).toContainText('Original conservé');
  await expect(original.getByRole('checkbox')).toBeDisabled();

  await page.getByRole('button', { name: 'Cocher toutes les copies' }).click();
  await expect(bar()).toContainText('1 sélectionné');
  await bar().getByRole('button', { name: 'Nettoyer…' }).click();
  await cleanDialog()
    .getByRole('checkbox', { name: /risque élevé/ })
    .check();
  await cleanDialog().getByRole('button', { name: 'Mettre à la Corbeille' }).click();
  await expect(page.getByTestId('clean-report')).toContainText('mis à la Corbeille');
  await cleanDialog().getByRole('button', { name: 'Fermer' }).click();
  expect(await exists(at('Downloads/copie.bin'))).toBe(false);

  const forged = await page.evaluate(async (file) => {
    const report = await window.macsweep.clean.execute([file], {
      dryRun: false,
      confirmProtected: true,
      confirmHighRisk: true,
    });
    return report.failed.map((f) => f.reason);
  }, at('Documents/original.bin'));
  expect(forged).toEqual(['last-copy']);
  expect(await exists(at('Documents/original.bin'))).toBe(true);
});

test('l’image Docker est affichée pour information, jamais cochable', async () => {
  await rescan();
  await expect(
    page.locator('[data-testid="category-card"][data-category="docker-data"]'),
  ).toContainText('Information');
  await page.getByRole('button', { name: 'Revoir et nettoyer' }).click();
  await expect(
    page
      .locator('[data-testid="review-category"][data-category="docker-data"]')
      .getByRole('checkbox'),
  ).toBeDisabled();
  await expect(
    page.locator('[data-testid="review-category"][data-category="large-files"]'),
  ).toHaveCount(0);
});
