import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, setConfig, test } from '../fixtures';

const OUT = resolve(process.env.SCREENS_DIR ?? 'test-results/options-screens');
mkdirSync(OUT, { recursive: true });

const config = {
  schemaVersion: 1,
  folders: [{ id: 'clients', name: 'Clients' }, { id: 'archive', name: 'Archive' }],
  tags: [{ id: 'urgent', name: 'Urgent' }, { id: 'internal', name: 'Internal' }, { id: 'reading', name: 'Reading' }],
  projects: [
    {
      id: 'articles',
      name: 'Articles',
      tagIds: ['reading', 'internal'],
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
    { id: 'shop', name: 'Shop orders', folderId: 'clients', tagIds: ['urgent'], scope: { allSites: true, domains: [] }, fields: [], siteMappings: {}, targets: [] },
    { id: 'blog', name: 'Blog posts', folderId: 'clients', tagIds: ['reading'], scope: { allSites: true, domains: [] }, fields: [], siteMappings: {}, targets: [] },
    { id: 'old', name: 'Old notes', folderId: 'archive', scope: { allSites: true, domains: [] }, fields: [], siteMappings: {}, targets: [] },
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
      // Options menu on the title "Projects".
      const titleMenuButton = page.getByRole('navigation', { name: t('Optionen', 'Options') }).getByRole('button', { name: t('Optionen für Projekte', 'Options for projects') });
      await titleMenuButton.click();
      await expect(page.getByRole('menu', { name: t('Optionen für Projekte', 'Options for projects') })).toBeVisible();
      await shot(page, 'sidebar-menu', tag);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toHaveCount(0);
      // Sorted A–Z (device setting), then back to manual: the sort menu entries and the sorted sidebar.
      const pickSort = async (name: string) => {
        await titleMenuButton.click();
        await page.getByRole('menuitemradio', { name }).click();
      };
      await pickSort('A–Z');
      await expect(page.getByRole('navigation', { name: t('Optionen', 'Options') }).locator('ul.options-nav-projects > li').first()).toBeVisible();
      await shot(page.getByRole('complementary'), 'sidebar-sorted', tag);
      await pickSort(t('Manuell', 'Manual'));
      // Sidebar with folders: projects without a folder first, one folder expanded, one collapsed.
      const folderRows = page.locator('ul.options-nav-projects li[data-testid="options-folder"]');
      await expect(folderRows).toHaveCount(2);
      const clients = folderRows.filter({ hasText: 'Clients' });
      const archive = folderRows.filter({ hasText: 'Archive' });
      if ((await clients.locator('button.options-folder-toggle').getAttribute('aria-expanded')) !== 'true') await clients.locator('button.options-folder-toggle').click();
      await expect(clients.locator('button.options-folder-toggle')).toHaveAttribute('aria-expanded', 'true');
      await expect(clients.locator('ul.options-folder-projects').getByText('Shop orders')).toBeVisible();
      if ((await archive.locator('button.options-folder-toggle').getAttribute('aria-expanded')) === 'true') await archive.locator('button.options-folder-toggle').click();
      await expect(archive.locator('button.options-folder-toggle')).toHaveAttribute('aria-expanded', 'false');
      await shot(page.getByRole('complementary'), 'sidebar-folders', tag);
      // While dragging a project onto the collapsed folder: drop frame and the "No folder" end zone; the drop returns to its own place.
      const sidebar = page.getByRole('complementary');
      const grip = sidebar.getByRole('button', { name: t('Projekt Products verschieben', 'Move project Products') });
      const own = await grip.boundingBox();
      if (!own) throw new Error('rows not laid out');
      await page.mouse.move(own.x + own.width / 2, own.y + own.height / 2);
      await page.mouse.down();
      // A first small move starts the drag; the target is reached in steps so that dragover fires on it.
      await page.mouse.move(own.x + own.width / 2 + 6, own.y + own.height / 2 + 6);
      // The end zone appears with the drag and moves the folders down, so the folder row is measured now.
      await expect(sidebar.locator('.options-drop-end')).toBeVisible();
      const head = await archive.locator('.options-folder-head').boundingBox();
      if (!head) throw new Error('folder row not laid out');
      await page.mouse.move(head.x + head.width / 2, head.y + head.height / 2, { steps: 12 });
      await page.mouse.move(head.x + head.width / 2 + 2, head.y + head.height / 2 + 1);
      await expect(archive.locator('.options-folder-head.is-drop-into')).toBeVisible();
      await shot(sidebar, 'sidebar-dragging', tag);
      await page.mouse.move(own.x + own.width / 2, own.y + own.height / 2, { steps: 8 });
      await page.mouse.up();
      await expect(sidebar.locator('.options-drop-end')).toHaveCount(0);
      await expect(archive.locator('button.options-folder-toggle')).toHaveAttribute('aria-expanded', 'false');
      // Tag field of the project: assigned tags as chips and the input with suggestions.
      await expect(page.getByRole('list', { name: t('Zugewiesene Tags', 'Assigned tags') }).getByText('Reading')).toBeVisible();
      await page.getByRole('combobox', { name: 'Tags' }).focus();
      await page.keyboard.press('ArrowDown');
      await expect(page.getByRole('listbox')).toBeVisible();
      await shot(page, 'project-tags', tag);
      await page.keyboard.press('Escape');
      await page.getByRole('combobox', { name: 'Tags' }).blur();
      // Active filter: only projects with a chosen tag, folders without a hit hidden, the others expanded.
      await page.getByRole('button', { name: 'Urgent', exact: true }).click();
      await page.getByRole('button', { name: 'Reading', exact: true }).click();
      await expect(page.getByText(t('3 Projekte sichtbar', '3 projects shown'))).toBeVisible();
      await expect(folderRows).toHaveCount(1);
      await shot(page.getByRole('complementary'), 'sidebar-filter', tag);
      await page.getByRole('button', { name: t('Filter zurücksetzen', 'Reset filter') }).click();
      await expect(folderRows).toHaveCount(2);
      // New folder: created at once with a name field in its row; a taken name shows the field error. Escape keeps the default name.
      await titleMenuButton.click();
      await page.getByRole('menuitem', { name: t('Ordner anlegen', 'Add folder') }).click();
      const folderName = page.getByLabel(t('Ordnername', 'Folder name'));
      await expect(folderName).toBeFocused();
      await expect(folderRows).toHaveCount(3);
      await shot(page.getByRole('complementary'), 'sidebar-folder-new', tag);
      await folderName.fill('clients');
      await expect(folderName).toHaveAttribute('aria-invalid', 'true');
      await shot(page.getByRole('complementary'), 'sidebar-folder-name-error', tag);
      await page.keyboard.press('Escape');
      await expect(folderName).toHaveCount(0);
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
      await nav.getByRole('link', { name: 'Tags' }).click();
      await expect(nav.getByRole('link', { name: 'Tags' })).toHaveAttribute('aria-current', 'page');
      await expect(page.getByTestId('options-tag')).toHaveCount(3);
      await shot(page, 'tags', tag);
      await nav.getByRole('link', { name: t('Einstellungen', 'Settings') }).click();
      await expect(nav.getByRole('link', { name: t('Einstellungen', 'Settings') })).toHaveAttribute('aria-current', 'page');
      await shot(page, 'settings', tag);
      await nav.getByRole('link', { name: t('Import und Export', 'Import and export') }).click();
      await expect(page.getByRole('button', { name: t('Aus Datei wiederherstellen', 'Restore from file') })).toBeVisible();
      await shot(page, 'import-export', tag);
      // Export manager: mixed folder state, the shared export dialog and the targets warning.
      const tree = page.getByRole('list', { name: t('Ordner und Projekte', 'Folders and projects') });
      await tree.getByRole('checkbox', { name: 'Articles' }).check();
      await tree.getByRole('checkbox', { name: 'Shop orders' }).check();
      await shot(page, 'export-manager', tag);
      await page.getByRole('button', { name: t('Auswahl exportieren…', 'Export selection…') }).click();
      const share = page.getByRole('dialog', { name: t('Auswahl exportieren', 'Export selection') });
      const targetsSwitch = share.getByRole('switch', { name: t('Ziele mitexportieren', 'Export targets too') });
      await expect(targetsSwitch).not.toBeChecked();
      await shot(share, 'export-dialog', tag);
      await targetsSwitch.click();
      const warning = page.getByRole('dialog', { name: t('Ziele mitexportieren?', 'Export targets too?') });
      await expect(warning).toBeVisible();
      await shot(warning, 'export-warning', tag);
      await warning.getByRole('button', { name: t('Abbrechen', 'Cancel') }).click();
      await expect(targetsSwitch).not.toBeChecked();
      await share.getByRole('button', { name: t('Abbrechen', 'Cancel') }).click();
      // Import dialog with the targets warning (existing project offered as copy or replace).
      const chooser = page.waitForEvent('filechooser');
      await titleMenuButton.click();
      await page.getByRole('menuitem', { name: t('Projekt aus Datei', 'Project from file') }).click();
      await (await chooser).setFiles({
        name: 'share.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({
          format: 'qatlas-clipper-share',
          schemaVersion: 1,
          targetsIncluded: true,
          folders: [{ id: 'shop-new', name: 'Shop' }],
          tags: [{ id: 'orders', name: 'Orders' }],
          projects: [
            { id: 'products', name: 'Products', scope: { allSites: true, domains: [] }, fields: [], siteMappings: {}, targets: [] },
            { id: 'order-notes', name: 'Order notes', folderId: 'shop-new', tagIds: ['orders'], scope: { allSites: true, domains: [] }, fields: [], siteMappings: {}, targets: [{ id: 'inbox', name: 'Inbox', url: 'https://hooks.example.com/inbox', headers: [], purpose: '' }] },
          ],
        })),
      });
      const importDialog = page.getByRole('dialog', { name: t('Aus Datei importieren', 'Import from file') });
      await expect(importDialog.getByRole('alert')).toContainText('https://hooks.example.com');
      await shot(importDialog, 'import-dialog', tag);
      await importDialog.getByRole('button', { name: t('Abbrechen', 'Cancel') }).click();
      const restoreChooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: t('Aus Datei wiederherstellen', 'Restore from file') }).click();
      await (await restoreChooser).setFiles({
        name: 'config.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, projects: [] })),
      });
      const replace = page.getByRole('dialog', { name: t('Konfiguration ersetzen?', 'Replace configuration?') });
      await expect(replace).toBeVisible();
      await shot(page, 'import-preview', tag);
      await replace.getByRole('button', { name: t('Abbrechen', 'Cancel') }).click();
      // Help: own address, entry marked as current, offline text with the example of the sent data.
      await nav.getByRole('link', { name: t('Hilfe', 'Help') }).click();
      await expect(nav.getByRole('link', { name: t('Hilfe', 'Help') })).toHaveAttribute('aria-current', 'page');
      await expect(page.getByRole('heading', { name: t('Gesendete Daten und Antwort', 'Sent data and response'), level: 3 })).toBeVisible();
      await shot(page, 'help', tag);
      await page.setViewportSize({ width: 360, height: 800 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await shot(page, 'help-360', tag);
      await page.setViewportSize({ width: 1100, height: 900 });
      await page.goto(`chrome-extension://${extensionId}/options.html#/projects/missing`);
      await expect(page.getByText(t('Projekt nicht gefunden', 'Project not found'))).toBeVisible();
      await shot(page, 'not-found', tag);
      await nav.getByRole('link', { name: 'Articles' }).click();
      await expect(page.getByLabel(t('Projektname', 'Project name'))).toBeVisible();

      // Narrow window: the sidebar stacks above the content, every entry stays reachable, the page does not scroll sideways.
      await page.setViewportSize({ width: 360, height: 800 });
      for (const name of ['Articles', 'Products', t('Projekte', 'Projects'), t('Einstellungen', 'Settings'), t('Import und Export', 'Import and export')]) {
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
