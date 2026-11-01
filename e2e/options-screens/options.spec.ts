import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, setConfig, test } from '../fixtures';

const OUT = resolve(process.env.SCREENS_DIR ?? 'test-results/options-screens');
mkdirSync(OUT, { recursive: true });

const config = {
  schemaVersion: 1,
  projects: [
    {
      id: 'articles',
      name: 'Articles',
      scope: { allSites: false, domains: ['example.com', 'example.org'], pageKind: 'article' },
      fields: [
        { key: 'headline', label: 'Headline', required: true, sources: { detect: 'title', schemaOrgPath: 'Article.headline' } },
        { key: 'price', label: 'Price', required: false, sources: {} },
        { key: 'status', label: 'Status', required: false, sources: { manual: { type: 'choice', values: ['Draft', 'In review', 'Final'] } } },
      ],
      siteMappings: { 'example.com': { price: '.price' }, 'example.org': { price: '#cost' } },
      targets: [],
    },
    { id: 'products', name: 'Products', scope: { allSites: true, domains: [] }, fields: [], siteMappings: {}, targets: [] },
  ],
};

async function shot(target: Page | Locator, name: string, tag: string) {
  // The sticky save bar would otherwise sit in the middle of a full-page capture.
  if ('setViewportSize' in target) await target.evaluate(() => window.scrollTo(0, 0));
  await target.screenshot({ path: join(OUT, `${tag}-${name}.png`), ...('setViewportSize' in target ? { fullPage: true } : {}) });
}

for (const lang of ['de', 'en'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`options screens ${lang} ${theme}`, async ({ context, serviceWorker, extensionId }) => {
      const tag = `${theme}-${lang}`;
      await serviceWorker.evaluate((settings) => chrome.storage.local.set({ settings }), { language: lang, appearance: theme });
      await setConfig(serviceWorker, config);
      const page = await context.newPage();
      await page.setViewportSize({ width: 1100, height: 900 });
      await page.goto(`chrome-extension://${extensionId}/options.html`);
      const t = (de: string, en: string) => (lang === 'de' ? de : en);
      await expect(page.getByRole('heading', { name: t('Felder', 'Fields'), level: 3 })).toBeVisible();

      const sections = page.locator('section.options-section');
      const field = (label: string) => page.getByRole('group', { name: label });
      await field('Headline').getByRole('button', { name: t('Erweitert', 'Advanced') }).click();
      await expect(field('Headline').getByLabel(t('Eigener schema.org-Pfad', 'Custom schema.org path'))).toBeVisible();

      await shot(page, 'project', tag);
      await shot(page.getByRole('navigation'), 'list', tag);
      await shot(sections.nth(0), 'scope', tag);
      await shot(sections.nth(1), 'fields', tag);
      await shot(sections.nth(2), 'mappings', tag);

      // Error feedback: an empty label and an empty project name block saving.
      await field('Price').getByLabel(t('Bezeichnung', 'Label'), { exact: true }).fill('');
      await page.getByLabel(t('Projektname', 'Project name')).fill('');
      await page.getByRole('button', { name: t('Änderungen speichern', 'Save changes') }).click();
      await expect(page.getByText(/Nicht gespeichert|Not saved/)).toBeVisible();
      await shot(page, 'error', tag);

      // Empty state.
      await page.getByRole('button', { name: t('Änderungen verwerfen', 'Discard changes') }).click();
      await setConfig(serviceWorker, { schemaVersion: 1, projects: [] });
      await page.reload();
      await expect(page.getByText(t('Noch kein Projekt', 'No project yet'))).toBeVisible();
      await shot(page, 'empty', tag);
      await page.close();
    });
  }
}
