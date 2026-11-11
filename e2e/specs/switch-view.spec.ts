import { expect, openPopup, openSidePanel, setConfig, test } from '../fixtures';

const config = {
  schemaVersion: 1,
  projects: [
    {
      id: 'products',
      name: 'Products',
      scope: { allSites: true, domains: [] },
      fields: [{ key: 'headline', label: 'Headline', required: false, sources: {} }],
      siteMappings: {},
      targets: [{ id: 't', name: 'Hook', url: 'https://hooks.example.com/in', headers: [], purpose: '' }],
    },
  ],
};

const openAsOf = (worker: import('@playwright/test').Worker) =>
  worker.evaluate(async () => ((await chrome.storage.local.get('settings')).settings as { openAs?: string } | undefined)?.openAs);

test.beforeEach(async ({ serviceWorker }) => {
  await setConfig(serviceWorker, config);
  await serviceWorker.evaluate(() => chrome.storage.local.remove('settings'));
});

// Playwright cannot show the real toolbar popup or confirm that the browser opened the side panel; the click may
// open or fail here. Both paths store the choice, which is what these specs check (the opening itself is manual).
test('the popup switch stores the side panel and the open options page follows without reload', async ({
  context,
  serviceWorker,
  extensionId,
  pages,
}) => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html#/settings`);
  await expect(options.getByRole('radio', { name: 'Popup' })).toBeChecked();

  const page = await context.newPage();
  await page.goto(`${pages.origin}/jsonld.html`);
  const popup = await openPopup(context, serviceWorker, extensionId, page);
  await popup.getByRole('button', { name: 'Open as side panel' }).click();

  await expect.poll(() => openAsOf(serviceWorker)).toBe('sidepanel');
  await expect(options.getByRole('radio', { name: 'Side panel' })).toBeChecked();
});

test('the side panel switch stores the popup and the open options page follows without reload', async ({
  context,
  serviceWorker,
  extensionId,
  pages,
}) => {
  await serviceWorker.evaluate(() => chrome.storage.local.set({ settings: { openAs: 'sidepanel' } }));
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html#/settings`);
  await expect(options.getByRole('radio', { name: 'Side panel' })).toBeChecked();

  const page = await context.newPage();
  await page.goto(`${pages.origin}/jsonld.html`);
  const panel = await openSidePanel(context, serviceWorker, extensionId, page);
  await panel.getByRole('button', { name: 'Open as popup' }).click();

  await expect.poll(() => openAsOf(serviceWorker)).toBe('popup');
  await expect(options.getByRole('radio', { name: 'Popup' })).toBeChecked();
});
