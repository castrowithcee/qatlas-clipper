import { expect, setConfig, tabIdOf, test } from '../fixtures';

// Must match PICKER_GLOBAL in entrypoints/picker.ts.
const PICKER_GLOBAL = '__qatlasPickerStart';

const config = {
  schemaVersion: 1,
  projects: [
    {
      id: 'products',
      name: 'Products',
      scope: { allSites: true, domains: [] },
      fields: [{ key: 'price', label: 'Price', required: true, sources: {} }],
      siteMappings: {},
      targets: [],
    },
  ],
};

test('saving in the options page keeps a click mapping stored from another tab', async ({ context, serviceWorker, extensionId, pages }) => {
  await setConfig(serviceWorker, config);

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(options.getByLabel('Project name')).toHaveValue('Products');

  // Second tab: save a mapping through the picker while the options page stays open.
  const page = await context.newPage();
  await page.goto(`${pages.origin}/picker-light.html`);
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

  // The options page shows the foreign mapping without a reload.
  await options.bringToFront();
  await options.getByRole('button', { name: 'Edit field Price' }).click();
  await expect(options.getByRole('dialog', { name: 'Price' }).getByRole('button', { name: 'Remove mapping for 127.0.0.1' })).toBeVisible();
  await options.keyboard.press('Escape');

  // Change another field and save.
  await options.getByLabel('Project name').fill('Products renamed');
  await options.getByRole('button', { name: 'Save changes' }).click();

  const stored = () =>
    serviceWorker.evaluate(async () => {
      const { config } = (await chrome.storage.local.get('config')) as {
        config: { projects: { name: string; siteMappings: unknown }[] };
      };
      return { name: config.projects[0]!.name, siteMappings: config.projects[0]!.siteMappings };
    });
  await expect.poll(stored).toEqual({ name: 'Products renamed', siteMappings: { '127.0.0.1': { price: '#price' } } });
  await options.getByRole('button', { name: 'Edit field Price' }).click();
  await expect(options.getByRole('dialog', { name: 'Price' }).getByRole('button', { name: 'Remove mapping for 127.0.0.1' })).toBeVisible();
  await options.keyboard.press('Escape');
  await expect(options.getByLabel('Project name')).toHaveValue('Products renamed');
});
