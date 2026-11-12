import { expect, setConfig, test } from '../fixtures';

const config = {
  schemaVersion: 1,
  projects: [{ id: 'products', name: 'Products', scope: { allSites: true, domains: [] }, fields: [], siteMappings: {}, targets: [] }],
};

test.beforeEach(async ({ serviceWorker }) => {
  await setConfig(serviceWorker, config);
  await serviceWorker.evaluate(() => chrome.storage.local.set({ settings: { language: 'en' } }));
});

test('the collapsed sidebar survives a reload and the button works by keyboard', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  const collapse = page.getByRole('button', { name: 'Collapse sidebar' });
  await expect(collapse).toHaveAttribute('aria-expanded', 'true');
  const before = await collapse.boundingBox();
  await collapse.focus();
  await page.keyboard.press('Enter');
  const expand = page.getByRole('button', { name: 'Expand sidebar' });
  await expect(expand).toBeFocused();
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  // Both buttons sit on the same spot at the top left.
  const after = await expand.boundingBox();
  expect(before && after).toBeTruthy();
  expect(Math.abs(after!.x - before!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(after!.y - before!.y)).toBeLessThanOrEqual(1);
  await expect(page.getByRole('navigation', { name: 'Options' })).toBeHidden();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Options' })).toBeHidden();

  await page.getByRole('button', { name: 'Expand sidebar' }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toHaveAttribute('aria-expanded', 'true');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible();
});

test('the narrow view has no collapse button, even when the setting is on', async ({ context, serviceWorker, extensionId }) => {
  await serviceWorker.evaluate(() => chrome.storage.local.set({ settings: { language: 'en', sidebarCollapsed: true } }));
  const page = await context.newPage();
  await page.setViewportSize({ width: 600, height: 800 });
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('navigation', { name: 'Options' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toHaveCount(0);
});
