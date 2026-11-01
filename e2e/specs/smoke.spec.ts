import { expect, openPopup, setConfig, test } from '../fixtures';

test('popup shows the values read from the JSON-LD page', async ({ context, serviceWorker, extensionId, pages, webhook }) => {
  await setConfig(serviceWorker, {
    schemaVersion: 1,
    projects: [
      {
        id: 'articles',
        name: 'Articles',
        scope: { allSites: true, domains: [] },
        fields: [
          { key: 'headline', label: 'Headline', required: true, sources: { schemaOrgPath: 'Article.headline' } },
          { key: 'author', label: 'Author', required: false, sources: { schemaOrgPath: 'Article.author.name' } },
        ],
        siteMappings: {},
        targets: [{ id: 'hook', name: 'Test hook', url: webhook.url, headers: [], purpose: 'e2e' }],
      },
    ],
  });

  const page = await context.newPage();
  await page.goto(`${pages.origin}/jsonld.html`);
  const popup = await openPopup(context, serviceWorker, extensionId, page);

  await expect(popup.getByRole('textbox', { name: 'Headline' })).toHaveValue('Example Headline');
  await expect(popup.getByRole('textbox', { name: 'Author' })).toHaveValue('Example Author');
  await expect(popup.getByRole('img', { name: 'Detected automatically' })).toHaveCount(2);
  await expect(popup.getByRole('button', { name: 'Send to Test hook' })).toBeVisible();
});
