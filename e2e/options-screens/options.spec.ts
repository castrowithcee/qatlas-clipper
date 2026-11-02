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
      targets: [
        { id: 'hook', name: 'Archive', url: 'https://example.com/hook', headers: ['Authorization'], purpose: 'Reading list' },
        { id: 'local', name: 'Local test', url: 'http://localhost:8787/hook', headers: [], purpose: '' },
      ],
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
      await setConfig(serviceWorker, config, { hook: { Authorization: 'Bearer example-key' } });
      const page = await context.newPage();
      await page.setViewportSize({ width: 1100, height: 900 });
      await page.goto(`chrome-extension://${extensionId}/options.html`);
      const t = (de: string, en: string) => (lang === 'de' ? de : en);
      await expect(page.getByRole('heading', { name: t('Felder', 'Fields'), level: 3 })).toBeVisible();

      const sections = page.locator('section.options-section');
      const field = (label: string) => page.getByRole('dialog', { name: label });
      const openField = (label: string) => page.getByRole('button', { name: t(`Feld ${label} bearbeiten`, `Edit field ${label}`) }).click();
      const closeField = (label: string) => field(label).getByRole('button', { name: t('Schließen', 'Close') }).click();
      await shot(page, 'project', tag);
      await shot(page.getByRole('complementary'), 'sidebar', tag);
      await shot(sections.nth(0), 'scope', tag);
      await shot(sections.nth(1), 'fields', tag);

      await openField('Headline');
      await field('Headline').getByRole('button', { name: t('Erweitert', 'Advanced') }).click();
      await expect(field('Headline').getByLabel(t('Eigener schema.org-Pfad', 'Custom schema.org path'))).toBeVisible();
      await shot(page, 'field-detail', tag);
      await closeField('Headline');
      await openField('Price');
      await shot(field('Price'), 'field-price', tag);
      await page.setViewportSize({ width: 360, height: 800 });
      await shot(page, 'field-price-360', tag);
      await page.setViewportSize({ width: 1100, height: 900 });
      await closeField('Price');

      // Targets: the first has no permission yet (text and icon); the e2e build already holds localhost, so the second one is allowed.
      const targets = sections.filter({ has: page.getByRole('heading', { name: t('Ziele', 'Targets'), level: 3 }) });
      const row = (name: string) => targets.getByRole('row', { name: new RegExp(name) });
      await expect(row('Archive').getByText(t('Zugriff fehlt', 'Access missing'))).toBeVisible();
      await expect(row('Local test').getByText(t('Zugriff erlaubt', 'Access allowed'))).toBeVisible();
      await shot(targets, 'targets', tag);
      await page.setViewportSize({ width: 360, height: 800 });
      await shot(targets, 'targets-360', tag);
      await page.setViewportSize({ width: 1100, height: 900 });

      const target = page.getByRole('dialog', { name: 'Archive' });
      await page.getByRole('button', { name: t('Ziel Archive bearbeiten', 'Edit target Archive') }).click();
      await expect(target.getByText(t('Zugriff fehlt', 'Access missing'))).toBeVisible();
      await expect(target.getByRole('button', { name: t('Erlauben', 'Allow') })).toBeVisible();
      // The stored header opens "Advanced", where the access key now lives.
      await expect(target.getByRole('button', { name: t('Erweitert', 'Advanced') })).toHaveAttribute('aria-expanded', 'true');
      await target.getByLabel(t('Zugangsschlüssel anzeigen', 'Show access key')).check();
      await expect(target.getByLabel(t('Zugangsschlüssel (optional)', 'Access key (optional)'))).toHaveValue('example-key');
      await shot(page, 'target-detail', tag);
      await page.setViewportSize({ width: 360, height: 800 });
      await shot(page, 'target-detail-360', tag);
      await page.setViewportSize({ width: 1100, height: 900 });
      await target.getByRole('button', { name: t('Schließen', 'Close') }).click();

      // Settings, import and export, and a project address that does not exist.
      const nav = page.getByRole('navigation', { name: t('Optionen', 'Options') });
      await nav.getByRole('link', { name: t('Einstellungen', 'Settings') }).click();
      await expect(nav.getByRole('link', { name: t('Einstellungen', 'Settings') })).toHaveAttribute('aria-current', 'page');
      await shot(page, 'settings', tag);
      await nav.getByRole('link', { name: t('Import und Export', 'Import and export') }).click();
      await expect(page.getByLabel(t('Aus Datei', 'From file'))).toBeVisible();
      await shot(page, 'import-export', tag);
      await page.getByLabel(t('Aus Datei', 'From file')).setInputFiles({
        name: 'config.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, projects: [] })),
      });
      const replace = page.getByRole('dialog', { name: t('Konfiguration ersetzen?', 'Replace configuration?') });
      await expect(replace).toBeVisible();
      await shot(page, 'import-preview', tag);
      await replace.getByRole('button', { name: t('Abbrechen', 'Cancel') }).click();
      await page.goto(`chrome-extension://${extensionId}/options.html#/projects/missing`);
      await expect(page.getByText(t('Projekt nicht gefunden', 'Project not found'))).toBeVisible();
      await shot(page, 'not-found', tag);
      await nav.getByRole('link', { name: 'Articles' }).click();
      await expect(page.getByLabel(t('Projektname', 'Project name'))).toBeVisible();

      // Narrow window: the sidebar stacks above the content, every entry stays reachable, the page does not scroll sideways.
      await page.setViewportSize({ width: 360, height: 800 });
      for (const name of ['Articles', 'Products', t('Projekt anlegen', 'Add project'), t('Einstellungen', 'Settings'), t('Import und Export', 'Import and export')]) {
        await nav.getByText(name, { exact: true }).scrollIntoViewIfNeeded();
        await expect(nav.getByText(name, { exact: true })).toBeVisible();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await shot(page, 'project-360', tag);
      await page.setViewportSize({ width: 1100, height: 900 });

      // Error feedback: an empty label and an empty project name block saving.
      await openField('Price');
      await field('Price').getByLabel(t('Bezeichnung', 'Label'), { exact: true }).fill('');
      // The dialog name follows the label, so it is no longer found as "Price".
      await page.getByRole('dialog').getByRole('button', { name: t('Schließen', 'Close') }).click();
      await page.getByLabel(t('Projektname', 'Project name')).fill('');
      await page.getByRole('button', { name: t('Änderungen speichern', 'Save changes') }).click();
      await expect(page.getByText(/Nicht gespeichert|Not saved/)).toBeVisible();
      await shot(page, 'error', tag);

      // Empty state.
      await page.getByRole('button', { name: t('Änderungen verwerfen', 'Discard changes') }).click();
      await setConfig(serviceWorker, { schemaVersion: 1, projects: [] });
      await page.goto(`chrome-extension://${extensionId}/options.html#/`);
      await page.reload();
      await expect(page.getByText(t('Noch kein Projekt', 'No project yet'))).toBeVisible();
      await shot(page, 'empty', tag);
      await page.close();
    });
  }
}
