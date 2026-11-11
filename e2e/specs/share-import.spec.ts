import { resolve } from 'node:path';
import { expect, setConfig, test } from '../fixtures';

const FILE = resolve(import.meta.dirname, '../data/share-import.json');

test('importing a share file shows the target address, places the project in its folder and replaces instead of duplicating', async ({ context, serviceWorker, extensionId }) => {
  await setConfig(serviceWorker, {
    schemaVersion: 1,
    projects: [{ id: 'existing', name: 'Existing', scope: { allSites: true, domains: [] }, fields: [], siteMappings: {}, targets: [] }],
  });
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page.getByLabel('Project name')).toHaveValue('Existing');

  await page.getByRole('button', { name: 'From file: project' }).locator('xpath=following-sibling::input').setInputFiles(FILE);
  const dialog = page.getByRole('dialog', { name: 'Import from file' });
  await expect(dialog.getByRole('alert')).toContainText('https://hooks.example.com');
  await dialog.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByText('Imported: 1 project.')).toBeVisible();
  await expect(page.getByLabel('Project name')).toHaveValue('Order notes');
  const folder = page.locator('li[data-testid="options-folder"]').filter({ hasText: 'Shop' });
  await expect(folder.locator('ul.options-folder-projects').getByText('Order notes')).toBeVisible();

  // Same file again, replacing: still one project of that name.
  await page.getByRole('button', { name: 'From file: folder' }).locator('xpath=following-sibling::input').setInputFiles(FILE);
  await dialog.getByLabel('Existing project "Order notes"').selectOption('replace');
  await dialog.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByText('Imported: 1 project.').last()).toBeVisible();
  const stored = await serviceWorker.evaluate(async () => ((await chrome.storage.local.get('config')).config as { projects: { name: string }[] }).projects.map((p) => p.name));
  expect(stored).toEqual(['Existing', 'Order notes']);
});
