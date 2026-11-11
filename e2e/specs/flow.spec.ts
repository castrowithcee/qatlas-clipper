import { WEBHOOK_ERROR_TEXT, WEBHOOK_RESPONSE } from '../servers';
import { expect, openPopup, test } from '../fixtures';

const HEADER_VALUE = 'test-token';
const ACCESS_KEY = 'test-key';

interface StoredConfig {
  projects: { fields: { key: string }[]; siteMappings: unknown }[];
}

const projectJson = (targetUrl: string) =>
  JSON.stringify({
    schemaVersion: 1,
    projects: [
      {
        id: 'products',
        name: 'Products',
        scope: { allSites: true, domains: [] },
        fields: [
          { key: 'price', label: 'Price', required: true, sources: {} },
          { key: 'headline', label: 'Headline', required: false, sources: { schemaOrgPath: 'Article.headline' } },
        ],
        siteMappings: {},
        targets: [{ id: 'hook', name: 'Test hook', url: targetUrl, headers: ['X-Token'], purpose: 'e2e' }],
      },
    ],
  });

test('configure, map by click, prefill on a second page, send, and show the response', async ({
  context,
  serviceWorker,
  extensionId,
  pages,
  webhook,
}) => {
  // 1. Configuration through the options UI: file import, then a header value in the target editor.
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html#/import-export`);
  await options.locator('input[type=file]').setInputFiles({
    name: 'config.json',
    mimeType: 'application/json',
    buffer: Buffer.from(projectJson(webhook.url)),
  });
  await expect(options.getByRole('dialog', { name: 'Replace configuration?' })).toBeVisible();
  await options.getByRole('button', { name: 'Replace', exact: true }).click();
  await options.getByRole('navigation', { name: 'Options' }).getByRole('link').first().click();
  await options.getByRole('button', { name: 'Edit target Test hook' }).click();
  const target = options.getByRole('dialog', { name: 'Test hook' });
  await expect(target.getByLabel('Name', { exact: true })).toHaveValue('Test hook');
  // The target has a header, so "Advanced" is open: the access key and the custom header sit there.
  await expect(target.getByRole('button', { name: 'Advanced' })).toHaveAttribute('aria-expanded', 'true');
  await target.getByLabel('Access key (optional)').fill(ACCESS_KEY);
  await target.getByLabel('Header value').fill(HEADER_VALUE);
  await target.getByRole('button', { name: 'Close' }).click();
  // A field added in the editor gets its key from the label and takes its value from a click on the page.
  await options.getByLabel('Label of the new field').fill('Sub title');
  await options.getByRole('button', { name: 'Add field' }).click();
  const subTitle = options.getByRole('dialog', { name: 'Sub title' });
  await expect(subTitle.getByLabel('Where does the value come from?')).toHaveValue('click');
  await subTitle.getByRole('button', { name: 'Close' }).click();
  await options.getByRole('button', { name: 'Save changes' }).click();
  await expect(options.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();

  const stored = await serviceWorker.evaluate(() => chrome.storage.local.get(['config', 'headerValues']));
  expect(stored.headerValues).toEqual({ hook: { 'X-Token': HEADER_VALUE, Authorization: `Bearer ${ACCESS_KEY}` } });
  expect(JSON.stringify(stored.config)).not.toContain(ACCESS_KEY);
  expect(JSON.stringify(stored.config)).toContain(webhook.url);
  expect((stored.config as StoredConfig).projects[0]!.fields.map((f) => f.key)).toEqual(['price', 'headline', 'sub_title']);
  await options.close();

  // 2. Reading (structured sources) on the JSON-LD and meta pages.
  const jsonld = await context.newPage();
  await jsonld.goto(`${pages.origin}/jsonld.html`);
  let popup = await openPopup(context, serviceWorker, extensionId, jsonld);
  await expect(popup.getByRole('textbox', { name: 'Headline' })).toHaveValue('Example Headline');
  await expect(popup.getByRole('img', { name: 'Detected automatically' })).toHaveCount(1);
  await popup.close();
  await jsonld.close();

  const meta = await context.newPage();
  await meta.goto(`${pages.origin}/meta.html`);
  await serviceWorker.evaluate(async () => {
    const { config } = (await chrome.storage.local.get('config')) as { config: StoredConfig };
    config.projects[0]!.fields.push({ key: 'description', label: 'Description', required: false, sources: { metaTag: { attribute: 'name', name: 'description' } } } as never);
    await chrome.storage.local.set({ config });
  });
  popup = await openPopup(context, serviceWorker, extensionId, meta);
  await expect(popup.getByRole('img', { name: 'Detected automatically' })).toHaveCount(1);
  await expect(popup.getByRole('textbox', { name: 'Description' })).not.toHaveValue('');
  await popup.close();
  await meta.close();
  // Back to the configured two-field project for the remaining steps.
  await serviceWorker.evaluate(async () => {
    const { config } = (await chrome.storage.local.get('config')) as { config: StoredConfig };
    config.projects[0]!.fields = config.projects[0]!.fields.filter((f) => f.key !== 'description');
    await chrome.storage.local.set({ config });
  });

  // 3. Mapping by click on a field without structured source.
  const page1 = await context.newPage();
  await page1.goto(`${pages.origin}/plain-1.html`);
  popup = await openPopup(context, serviceWorker, extensionId, page1);
  await expect(popup.getByRole('textbox', { name: 'Price' })).toHaveValue('');
  await popup.getByRole('button', { name: 'Click Price on the page' }).click();
  await popup.waitForEvent('close');

  await expect(page1.getByText('Choose element for "Price"')).toBeVisible();
  await page1.locator('#price').click();
  await expect(page1.locator('.preview-text')).toHaveText('10.00');
  await expect(page1.getByText('Saved for 127.0.0.1')).toBeVisible();
  await expect(page1.getByText('Choose element for')).toHaveCount(0);

  const mappings = await serviceWorker.evaluate(
    async () => ((await chrome.storage.local.get('config')) as { config: StoredConfig }).config.projects[0]!.siteMappings,
  );
  expect(mappings).toEqual({ '127.0.0.1': { price: '#price' } });
  await page1.close();

  // 4. A second page of the same domain is prefilled from the mapping.
  const page2 = await context.newPage();
  await page2.goto(`${pages.origin}/plain-2.html`);
  popup = await openPopup(context, serviceWorker, extensionId, page2);
  await expect(popup.getByRole('textbox', { name: 'Price' })).toHaveValue('20.00');
  await expect(popup.getByRole('img', { name: 'Assigned by click' })).toHaveCount(1);

  // 5. Send with an edited value and a note.
  await popup.getByRole('textbox', { name: 'Price' }).fill('21.50');
  await popup.getByRole('textbox', { name: 'Note' }).fill('Checked by e2e');
  await popup.getByRole('button', { name: 'Send to Test hook' }).click();

  await expect(popup.getByText(WEBHOOK_RESPONSE.message, { exact: true })).toBeVisible();
  const link = popup.getByRole('link', { name: WEBHOOK_RESPONSE.url });
  await expect(link).toHaveAttribute('href', WEBHOOK_RESPONSE.url);

  expect(webhook.requests).toHaveLength(1);
  const req = webhook.requests[0]!;
  expect(req.method).toBe('POST');
  expect(req.path).toBe('/hook');
  expect(req.headers['x-token']).toBe(HEADER_VALUE);
  expect(req.headers['authorization']).toBe(`Bearer ${ACCESS_KEY}`);
  const body = req.body as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(
    ['captured_at', 'content', 'content_format', 'fields', 'note', 'project', 'target', 'title', 'url', 'version'].sort(),
  );
  expect(body.version).toBe(1);
  expect(body.url).toBe(`${pages.origin}/plain-2.html`);
  expect(body.note).toBe('Checked by e2e');
  expect((body.fields as Record<string, unknown>).price).toBe('21.50');
  expect(typeof body.captured_at).toBe('string');
  // The default project has no content setting, which means real Markdown.
  expect(body.content_format).toBe('markdown');
  expect(typeof body.content).toBe('string');
  expect(body.content).not.toMatch(/<(p|div|body|h1)[\s>]/);
  expect(typeof body.title).toBe('string');
  expect(body.project).toBeDefined();
  expect(body.target).toBeDefined();
  await popup.close();
  await page2.close();
});

test('an error response shows a short message, the response text and a retry in the popup', async ({ context, serviceWorker, extensionId, pages, webhook }) => {
  await serviceWorker.evaluate(
    ([config]) => chrome.storage.local.set({ config }),
    [JSON.parse(projectJson(webhook.errorUrl))],
  );
  const page = await context.newPage();
  await page.goto(`${pages.origin}/plain-1.html`);
  const popup = await openPopup(context, serviceWorker, extensionId, page);
  await popup.getByRole('textbox', { name: 'Price' }).fill('1.00');
  await popup.getByRole('button', { name: 'Send to Test hook' }).click();

  const alert = popup.getByRole('alert').filter({ hasText: 'The target answered with error 500.' });
  await expect(alert).toBeVisible();
  await expect(alert.getByText(WEBHOOK_ERROR_TEXT, { exact: true })).toBeVisible();
  expect(webhook.requests).toHaveLength(1);
});
