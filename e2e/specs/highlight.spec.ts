import { expect, openPopup, setConfig, test } from '../fixtures';

const config = {
  schemaVersion: 1,
  projects: [
    {
      id: 'products',
      name: 'Products',
      scope: { allSites: true, domains: [] },
      fields: [
        { key: 'headline', label: 'Headline', required: false, sources: {} },
        { key: 'price', label: 'Price', required: false, sources: {} },
      ],
      siteMappings: { '127.0.0.1': { price: '#price' } },
      targets: [{ id: 't', name: 'Hook', url: 'https://hooks.example.com/in', headers: [], purpose: '' }],
    },
  ],
};

const SWITCH = { name: 'Highlight mapped elements on the page' };

/** Extension hosts in the page: the frames live in a Shadow DOM host appended to the root element. */
const hostCount = (page: import('@playwright/test').Page) =>
  page.evaluate(() => [...document.documentElement.children].filter((el) => el.shadowRoot !== null).length);

test.beforeEach(async ({ serviceWorker }) => {
  await setConfig(serviceWorker, config);
  await serviceWorker.evaluate(() => chrome.storage.local.remove('settings'));
});

test('frames the mapped element with its field name and leaves nothing behind after closing', async ({ context, serviceWorker, extensionId, pages }) => {
  const page = await context.newPage();
  await page.goto(`${pages.origin}/picker-light.html`);
  const popup = await openPopup(context, serviceWorker, extensionId, page);
  await expect(popup.getByRole('button', SWITCH)).toHaveAttribute('aria-pressed', 'true');

  const frames = page.locator('.frame');
  await expect(frames).toHaveCount(1);
  await expect(frames.locator('.label')).toHaveText('Price');
  const box = await page.locator('#price').boundingBox();
  const frame = await frames.boundingBox();
  expect(Math.abs(frame!.x - box!.x)).toBeLessThan(3);
  expect(Math.abs(frame!.y - box!.y)).toBeLessThan(3);

  await popup.close();
  await expect.poll(() => hostCount(page)).toBe(0);
});

test('the switch hides the frames at once and stays off after opening again', async ({ context, serviceWorker, extensionId, pages }) => {
  const page = await context.newPage();
  await page.goto(`${pages.origin}/picker-light.html`);
  let popup = await openPopup(context, serviceWorker, extensionId, page);
  await expect(page.locator('.frame')).toHaveCount(1);

  await popup.getByRole('button', SWITCH).click();
  await expect(popup.getByRole('button', SWITCH)).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => hostCount(page)).toBe(0);
  await popup.close();

  popup = await openPopup(context, serviceWorker, extensionId, page);
  await expect(popup.getByRole('button', SWITCH)).toHaveAttribute('aria-pressed', 'false');
  await popup.getByRole('textbox').first().waitFor();
  expect(await hostCount(page)).toBe(0);

  await popup.getByRole('button', SWITCH).click();
  await expect(page.locator('.frame')).toHaveCount(1);
});

test('the side panel frames the page too and removes the frames when it closes', async ({ context, serviceWorker, extensionId, pages }) => {
  const page = await context.newPage();
  await page.goto(`${pages.origin}/picker-light.html`);
  const tabId = await serviceWorker.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]!.id, page.url());
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tabId=${tabId}`);
  await expect(page.locator('.frame .label')).toHaveText('Price');
  await panel.close();
  await expect.poll(() => hostCount(page)).toBe(0);
});
