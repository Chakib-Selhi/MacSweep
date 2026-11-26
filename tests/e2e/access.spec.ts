import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { chmod, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createFakeHome, launchApp, type FakeHome } from './fixture';

// A fake ~/Library/Mail that refuses reading plays the role of a folder protected by macOS.
let home: FakeHome;
let app: ElectronApplication;
let page: Page;
let mail: string;

test.beforeAll(async () => {
  home = await createFakeHome();
  mail = path.join(home.root, 'Library/Mail');
  await mkdir(mail, { recursive: true });
  await chmod(mail, 0o000);
  app = await launchApp(home);
  page = await app.firstWindow();
});

test.afterAll(async () => {
  await app.close();
  await chmod(mail, 0o755);
  await home.cleanup();
});

test('le tableau de bord explique comment donner l’Accès complet au disque', async () => {
  const banner = page.getByTestId('disk-access-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Accès complet au disque désactivé');
  await banner.getByText('Comment l’activer ?').click();
  await expect(banner.getByRole('listitem')).toHaveCount(3);
  await expect(banner.getByRole('button', { name: 'Ouvrir les Réglages Système' })).toBeEnabled();
});

test('le bandeau disparaît quand l’accès est accordé', async () => {
  await chmod(mail, 0o755);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('disk-access-banner')).toHaveCount(0);
});
