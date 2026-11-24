import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { createFakeHome, launchApp, type FakeHome } from './fixture';

let home: FakeHome;
let app: ElectronApplication;
let page: Page;

const bar = () => page.getByTestId('selection-bar').getByRole('status');
const category = (id: string) =>
  page.locator(`[data-testid="review-category"][data-category="${id}"]`);
const item = (pathEnd: string) =>
  page.locator(`[data-testid="review-item"][data-path$="${pathEnd}"]`);

test.beforeAll(async () => {
  home = await createFakeHome();
  await home.file('Library/Caches/com.exemple.app/cache.db', 200_000);
  // The app under test is Electron itself: its cache must be flagged as belonging to an open app.
  await home.file('Library/Caches/com.github.Electron/cache.db', 100_000);
  await home.file('Library/Logs/app.log', 8192);
  await home.file(
    'Library/Developer/Xcode/Archives/2026-01-01/Projet.xcarchive/Info.plist',
    50_000,
  );
  await home.file('.Trash/ancien.txt');

  app = await launchApp(home);
  page = await app.firstWindow();
  await page.getByRole('button', { name: 'Lancer le scan' }).click();
  await expect(page.getByTestId('scan-summary')).toContainText('Scan terminé', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Revoir et nettoyer' }).click();
});

test.afterAll(async () => {
  await app.close();
  await home.cleanup();
});

test('coche par défaut les catégories à faible risque, sauf les apps ouvertes', async () => {
  await expect(page.getByRole('heading', { name: 'Revue avant nettoyage' })).toBeVisible();
  // com.exemple.app + app.log; Electron's cache (open app), Archives (medium) and Trash are left out.
  await expect(bar()).toContainText('2 sélectionnés');
  await expect(category('xcode-archives').getByRole('checkbox')).not.toBeChecked();
  await expect(category('trash').getByRole('checkbox')).toBeDisabled();
});

test('signale l’app ouverte et empêche de cocher son cache', async () => {
  await category('user-caches')
    .getByRole('button', { name: /Afficher les éléments/ })
    .click();
  const electronCache = item('/com.github.Electron');
  await expect(electronCache).toContainText('App ouverte (Electron) : fermez-la d’abord');
  await expect(electronCache.getByRole('checkbox')).toBeDisabled();
  await expect(item('/com.exemple.app').getByRole('checkbox')).toBeChecked();
  await expect(category('user-caches')).toContainText('1 lié à une app ouverte');
});

test('décocher une catégorie met à jour le total', async () => {
  await category('user-logs').getByRole('checkbox').uncheck();
  await expect(bar()).toContainText('1 sélectionné');
  await category('user-logs').getByRole('checkbox').check();
  await expect(bar()).toContainText('2 sélectionnés');
});

test('la recherche filtre, puis Tout et Rien agissent sur les résultats', async () => {
  const search = page.getByRole('searchbox', { name: 'Rechercher un chemin' });
  await search.fill('archives');
  await expect(page.getByTestId('review-item')).toHaveCount(1);
  await expect(page.getByTestId('review-category')).toHaveCount(1);

  await page.getByRole('button', { name: 'Tout sélectionner' }).click();
  await expect(bar()).toContainText('3 sélectionnés');

  await search.fill('');
  await page.getByRole('button', { name: 'Ne rien sélectionner' }).click();
  await expect(bar()).toContainText('0 sélectionné');

  await page.getByRole('button', { name: 'Tout sélectionner' }).click();
  // Everything selectable: the open app's cache and the Trash stay out.
  await expect(bar()).toContainText('3 sélectionnés');
});

test('le nettoyage reste désactivé jusqu’au jalon M4', async () => {
  await expect(page.getByRole('button', { name: 'Nettoyer…' })).toBeDisabled();
});

test('le retour au tableau de bord conserve la sélection', async () => {
  await page.getByRole('button', { name: '← Tableau de bord' }).click();
  await expect(
    page.locator('[data-testid="category-card"][data-category="xcode-archives"]'),
  ).toContainText('cochés');
});
