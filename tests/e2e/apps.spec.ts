import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createFakeHome, launchApp, type FakeHome } from './fixture';

// The fake /Applications sits next to the fake home folder, both in the temporary directory.
let home: FakeHome;
let app: ElectronApplication;
let page: Page;
let root: string;
let apps: string;

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );
const plist = (bundleId: string) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${bundleId}</string></dict></plist>
`;

async function fakeApp(name: string, bundleId: string, appStore = false): Promise<void> {
  const contents = path.join(home.disk, 'Applications', `${name}.app`, 'Contents');
  await mkdir(path.join(contents, 'MacOS'), { recursive: true });
  await writeFile(path.join(contents, 'Info.plist'), plist(bundleId));
  await writeFile(path.join(contents, 'MacOS', name), Buffer.alloc(300_000, 1));
  if (appStore) {
    await mkdir(path.join(contents, '_MASReceipt'), { recursive: true });
    await writeFile(path.join(contents, '_MASReceipt/receipt'), 'x');
  }
}

const row = (name: string) => page.getByTestId('app-row').filter({ hasText: name });
const detail = () => page.getByTestId('app-detail');
const dialog = () => page.getByTestId('uninstall-dialog');

async function forged(appPath: string, confirmName: string): Promise<string[]> {
  return page.evaluate(
    async ([target, name]) => {
      const report = await window.macsweep.apps.uninstall(target, {
        confirmName: name,
        leftovers: [],
        dryRun: false,
      });
      return report.failed.map((failure) => failure.reason);
    },
    [appPath, confirmName] as const,
  );
}

test.beforeAll(async () => {
  home = await createFakeHome();
  await fakeApp('OutilEssai', 'com.macsweep.essai.outil');
  await fakeApp('PommeEssai', 'com.apple.macsweep-essai');
  await fakeApp('BoutiqueEssai', 'com.macsweep.essai.boutique', true);
  await home.file('Library/Caches/com.macsweep.essai.outil/cache.db', 50_000);
  await home.file('Library/Application Support/OutilEssai/donnees.sqlite', 20_000);
  root = await realpath(home.root);
  apps = path.join(await realpath(home.disk), 'Applications');

  app = await launchApp(home);
  page = await app.firstWindow();
  await page
    .getByRole('navigation', { name: 'Navigation principale' })
    .getByRole('button', { name: 'Applications' })
    .click();
  await expect(page.getByTestId('app-row')).toHaveCount(3, { timeout: 20_000 });
});

test.afterAll(async () => {
  await app.close();
  await home.cleanup();
});

test('les apps Apple et de l’App Store sont listées mais pas désinstallables', async () => {
  await row('PommeEssai').click();
  await expect(page.getByTestId('app-refusal')).toContainText('app Apple');
  await expect(detail().getByRole('button', { name: 'Désinstaller…' })).toBeDisabled();
  await row('BoutiqueEssai').click();
  await expect(page.getByTestId('app-refusal')).toContainText('App Store');
});

test('les restes sont trouvés, et les données de l’app restent décochées', async () => {
  await row('OutilEssai').click();
  await expect(page.getByTestId('leftover')).toHaveCount(2);
  await expect(detail().getByLabel('Inclure com.macsweep.essai.outil')).toBeChecked();
  await expect(detail().getByLabel('Inclure OutilEssai')).not.toBeChecked();
});

test('désinstaller demande le nom de l’app puis met l’app et les restes cochés à la Corbeille', async () => {
  await detail().getByRole('checkbox', { name: 'Mode simulation' }).uncheck();
  await detail().getByRole('button', { name: 'Désinstaller…' }).click();
  const confirm = dialog().getByRole('button', { name: 'Mettre à la Corbeille' });
  await expect(confirm).toBeDisabled();
  await dialog().getByRole('textbox').fill('outilessai');
  await expect(confirm).toBeDisabled();
  await dialog().getByRole('textbox').fill('OutilEssai');
  await confirm.click();
  await expect(dialog().getByTestId('clean-report')).toContainText('mis à la Corbeille');
  await dialog().getByRole('button', { name: 'Fermer' }).click();

  expect(await exists(path.join(apps, 'OutilEssai.app'))).toBe(false);
  expect(await readdir(path.join(root, '.Trash'))).toEqual(
    expect.arrayContaining(['OutilEssai.app', 'com.macsweep.essai.outil']),
  );
  expect(await exists(path.join(root, 'Library/Application Support/OutilEssai'))).toBe(true);
  await expect(page.getByTestId('app-row')).toHaveCount(2);
});

test('le processus principal refuse les demandes forgées', async () => {
  expect(await forged(path.join(apps, 'PommeEssai.app'), 'PommeEssai')).toEqual(['apple-app']);
  expect(await forged(path.join(apps, 'BoutiqueEssai.app'), 'BoutiqueEssai')).toEqual([
    'app-store',
  ]);
  expect(await forged('/Applications/Safari.app', 'Safari')).toEqual(['not-scanned']);
  expect(await exists(path.join(apps, 'PommeEssai.app'))).toBe(true);
});
