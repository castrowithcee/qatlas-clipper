import { expect, openPopup, setConfig, test } from '../fixtures';

const config = (fields: unknown[] = [], siteMappings: unknown = {}) => ({
  schemaVersion: 1,
  projects: [{ id: 'items', name: 'Items', scope: { allSites: true, domains: [] }, fields, siteMappings, targets: [{ id: 'hook', name: 'Test hook', url: 'https://hooks.example.com/in', headers: [], purpose: '' }] }],
});

test('a field added in the popup is picked on the page, read on reopening and shown by an open options page', async ({
  context,
  serviceWorker,
  extensionId,
  pages,
}) => {
  await setConfig(serviceWorker, config());
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html#/projects/items`);
  await expect(options.getByLabel('Project name')).toHaveValue('Items');
  await expect(options.getByRole('button', { name: 'Edit field Cost' })).toHaveCount(0);

  const page = await context.newPage();
  await page.goto(`${pages.origin}/plain-1.html`);
  let popup = await openPopup(context, serviceWorker, extensionId, page);
  await popup.getByLabel('New field').fill('Cost');
  await popup.getByRole('button', { name: 'Add' }).click();
  await popup.waitForEvent('close');

  await expect(page.getByText('Choose element for "Cost"')).toBeVisible();
  // The options page (not reloaded) already shows the saved field.
  await expect(options.getByRole('button', { name: 'Edit field Cost' })).toBeVisible();

  await page.locator('#price').click();
  await expect(page.getByText('Saved for 127.0.0.1')).toBeVisible();

  popup = await openPopup(context, serviceWorker, extensionId, page);
  await expect(popup.getByRole('textbox', { name: 'Cost' })).toHaveValue('10.00');
});

test('the field menu saves at once and removing the assignment of this site empties the value', async ({
  context,
  serviceWorker,
  extensionId,
  pages,
}) => {
  const fields = [{ key: 'price', label: 'Price', required: false, format: 'markdown', sources: {} }];
  await setConfig(serviceWorker, config(fields, { '127.0.0.1': { price: '#price' }, 'other.example.org': { price: '#x' } }));
  const page = await context.newPage();
  await page.goto(`${pages.origin}/plain-1.html`);
  const popup = await openPopup(context, serviceWorker, extensionId, page);
  const price = popup.getByRole('textbox', { name: 'Price' });
  await expect(price).toHaveValue('10.00');
  const stored = () =>
    serviceWorker.evaluate(
      async () =>
        ((await chrome.storage.local.get('config')) as { config: { projects: { fields: { required: boolean; format: string }[]; siteMappings: object }[] } }).config
          .projects[0]!,
    );

  const menu = popup.getByRole('button', { name: 'Options for Price' });
  await menu.click();
  await popup.getByRole('menuitemcheckbox', { name: 'Required' }).click();
  await expect.poll(async () => (await stored()).fields[0]!.required).toBe(true);
  await popup.getByRole('textbox', { name: 'Note' }).fill('kept');

  await menu.click();
  await popup.getByRole('menuitemradio', { name: 'Text' }).click();
  await expect.poll(async () => (await stored()).fields[0]!.format).toBe('text');

  await menu.click();
  await popup.getByRole('menuitem', { name: 'Remove assignment for this website' }).click();
  await expect(price).toHaveValue('');
  expect((await stored()).siteMappings).toEqual({ 'other.example.org': { price: '#x' } });
  await expect(popup.getByRole('textbox', { name: 'Note' })).toHaveValue('kept');
  await menu.click();
  await expect(popup.getByRole('menuitem', { name: 'Remove assignment for this website' })).toHaveCount(0);
  await popup.keyboard.press('Escape');
  await expect(menu).toBeFocused();
});
