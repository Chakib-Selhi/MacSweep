import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createFakeHome, launchApp, type FakeHome } from './fixture';

// The app runs on a fake home folder: its "Trash" is <fake home>/.Trash, never the user's real one.
let home: FakeHome;
let app: ElectronApplication;
let page: Page;

const at = (...parts: string[]) => path.join(home.root, ...parts);
const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );
const dialog = (testId: string) => page.getByTestId(testId);
const bar = () => page.getByTestId('selection-bar');

async function openReview() {
  await page.getByRole('button', { name: 'Tableau de bord' }).first().click();
  await page.getByRole('button', { name: 'Revoir et nettoyer' }).click();
}

test.beforeAll(async () => {
  home = await createFakeHome();
  await home.file('Library/Caches/com.exemple.app/cache.db', 200_000);
  await home.file('Library/Caches/com.autre.app/cache.db', 100_000);
  await home.file('Library/Logs/app.log', 8192);
  await home.file('.Trash/ancien.txt', 4096);
  await home.file('.Trash/dossier/dedans.txt', 4096);

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

test('au premier lancement, le mode simulation est actif', async () => {
  await expect(page.getByTestId('dry-run-banner')).toBeVisible();
  await expect(bar().getByRole('checkbox', { name: /Mode simulation/ })).toBeChecked();
  await expect(bar()).toContainText('3 sélectionnés');
});

test('la simulation ne déplace aucun fichier', async () => {
  await bar().getByRole('button', { name: 'Nettoyer…' }).click();
  await expect(dialog('clean-dialog')).toContainText('Simuler le nettoyage');
  await expect(dialog('clean-dialog')).toContainText('aucun fichier ne sera déplacé');
  await dialog('clean-dialog').getByRole('button', { name: 'Lancer la simulation' }).click();
  await expect(page.getByTestId('clean-report')).toContainText('Simulation : 3 éléments');
  await expect(page.getByTestId('clean-report')).toContainText('Rien n’a été déplacé');
  await dialog('clean-dialog').getByRole('button', { name: 'Fermer' }).click();

  expect(await exists(at('Library/Caches/com.exemple.app/cache.db'))).toBe(true);
  expect(await exists(at('Library/Logs/app.log'))).toBe(true);
  expect((await readdir(at('.Trash'))).sort()).toEqual(['ancien.txt', 'dossier']);
  await expect(bar()).toContainText('3 sélectionnés');
});

test('le nettoyage réel met à la Corbeille, journalise et retire les éléments', async () => {
  await bar()
    .getByRole('checkbox', { name: /Mode simulation/ })
    .uncheck();
  await expect(page.getByTestId('dry-run-banner')).toHaveCount(0);

  await bar().getByRole('button', { name: 'Nettoyer…' }).click();
  await expect(dialog('clean-dialog')).toContainText('Destination : la Corbeille');
  await dialog('clean-dialog').getByRole('button', { name: 'Mettre à la Corbeille' }).click();
  await expect(page.getByTestId('clean-report')).toContainText('mis à la Corbeille');
  await dialog('clean-dialog').getByRole('button', { name: 'Fermer' }).click();

  expect(await exists(at('Library/Caches/com.exemple.app'))).toBe(false);
  expect(await exists(at('Library/Logs/app.log'))).toBe(false);
  expect((await readdir(at('.Trash'))).sort()).toEqual(
    ['ancien.txt', 'app.log', 'com.autre.app', 'com.exemple.app', 'dossier'].sort(),
  );
  await expect(bar()).toContainText('0 sélectionné');
  await expect(
    page.locator('[data-testid="review-category"][data-category="user-caches"]'),
  ).toHaveCount(0);

  const userData = await app.evaluate(({ app: electron }) => electron.getPath('userData'));
  const logsDir = path.join(userData, 'logs');
  const [logFile] = await readdir(logsDir);
  const lines = (await readFile(path.join(logsDir, logFile as string), 'utf8')).trim().split('\n');
  expect(lines).toHaveLength(3);
  expect(JSON.parse(lines[0] as string)).toMatchObject({ action: 'trash' });
});

test('l’historique liste le nettoyage réel, pas la simulation', async () => {
  await page.getByRole('button', { name: 'Historique' }).click();
  const rows = page.getByTestId('history-table').locator('tbody tr');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Nettoyage');
  await expect(rows.first()).toContainText('Caches utilisateur');
});

test('les appels IPC forgés ne déplacent rien', async () => {
  await home.file('Library/Caches/hors-scan/x');
  const outcome = await page.evaluate(async (root) => {
    const api = window.macsweep as unknown as {
      clean: {
        execute(
          paths: unknown,
          request: unknown,
        ): Promise<{ moved: unknown[]; failed: { reason: string }[] }>;
      };
      trash: { empty(word: unknown): Promise<unknown> };
      settings: { set(patch: unknown): Promise<unknown> };
    };
    const refused = (call: () => Promise<unknown>) =>
      call().then(
        () => 'accepté',
        () => 'refusé',
      );
    const report = await api.clean.execute(
      ['/etc/hosts', `${root}/Library/Caches/hors-scan`, `${root}/.Trash/ancien.txt`],
      { dryRun: false },
    );
    return {
      moved: report.moved.length,
      reasons: report.failed.map((f) => f.reason),
      notAList: await refused(() => api.clean.execute('/etc', { dryRun: false })),
      wrongWord: await refused(() => api.trash.empty('vider')),
      badSetting: await refused(() => api.settings.set({ dryRun: 'non' })),
    };
  }, home.root);
  expect(outcome).toEqual({
    moved: 0,
    reasons: ['outside-root', 'not-scanned', 'trash'],
    notAList: 'refusé',
    wrongWord: 'refusé',
    badSetting: 'refusé',
  });
  expect(await exists(at('Library/Caches/hors-scan/x'))).toBe(true);
  expect(await exists(at('.Trash/ancien.txt'))).toBe(true);
});

test('vider la Corbeille exige de taper VIDER', async () => {
  await openReview();
  await page
    .locator('[data-testid="review-category"][data-category="trash"]')
    .getByRole('button', { name: 'Vider la Corbeille…' })
    .click();
  const trashDialog = dialog('empty-trash-dialog');
  await expect(trashDialog).toContainText('Suppression définitive');
  const confirm = trashDialog.getByRole('button', { name: 'Vider définitivement' });
  const input = trashDialog.getByRole('textbox', { name: 'Tape VIDER pour confirmer' });

  await input.fill('vider');
  await expect(confirm).toBeDisabled();
  await input.fill('VIDER');
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.getByTestId('trash-report')).toContainText('Corbeille vidée');
  await trashDialog.getByRole('button', { name: 'Fermer' }).click();

  expect(await readdir(at('.Trash'))).toEqual([]);
  expect(await exists(at('Library/Caches/hors-scan/x'))).toBe(true);
});
