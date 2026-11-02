import { expect, openSidePanel, setConfig, tabIdOf, test } from '../fixtures';

// Must match PICKER_GLOBAL in entrypoints/picker.ts.
const PICKER_GLOBAL = '__qatlasPickerStart';

const config = (webhookUrl: string) => ({
  schemaVersion: 1,
  projects: [
    {
      id: 'products',
      name: 'Products',
      scope: { allSites: true, domains: [] },
      fields: [{ key: 'price', label: 'Price', required: false, sources: {} }],
      siteMappings: {},
      targets: [{ id: 'hook', name: 'Test hook', url: webhookUrl, headers: [], purpose: 'e2e' }],
    },
  ],
});

test('the side panel reads the page, shows a mapping made on the page and follows navigation', async ({
  context,
  serviceWorker,
  extensionId,
  pages,
  webhook,
}) => {
  await setConfig(serviceWorker, config(webhook.url));
  const page = await context.newPage();
  await page.goto(`${pages.origin}/picker-light.html`);
  const panel = await openSidePanel(context, serviceWorker, extensionId, page);

  await expect(panel.getByText('Picker Light Page')).toBeVisible();
  await expect(panel.getByRole('textbox', { name: 'Price' })).toHaveValue('');

  // Map the price on the page while the panel stays open.
  const tabId = await tabIdOf(serviceWorker, page);
  await serviceWorker.evaluate(
    async ([id, globalName]) => {
      await chrome.scripting.executeScript({ target: { tabId: id as number }, files: ['/picker.js'] });
      await chrome.scripting.executeScript({
        target: { tabId: id as number },
        args: [globalName as string, 'products', 'price'],
        func: (g: string, p: string, f: string) => {
          (globalThis as unknown as Record<string, (a: string, b: string) => void>)[g]!(p, f);
        },
      });
    },
    [tabId, PICKER_GLOBAL] as const,
  );
  await page.locator('#price').click();
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Mapping saved')).toBeVisible();

  await panel.bringToFront();
  await expect(panel.getByRole('textbox', { name: 'Price' })).toHaveValue('10.00');

  // Navigating the tab reads the new page without reopening the panel.
  await page.goto(`${pages.origin}/plain-1.html`);
  await expect(panel.getByText('Plain Page 1')).toBeVisible();
});
