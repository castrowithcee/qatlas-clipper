import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, openPopup, setConfig, test } from '../fixtures';

const OUT = resolve(process.env.SCREENS_DIR ?? 'test-results/popup-screens');
mkdirSync(OUT, { recursive: true });

const field = (key: string, label: string, required: boolean, sources: object = {}) => ({ key, label, required, sources });
const project = (targets: unknown[], fields = [field('headline', 'Headline', true, { schemaOrgPath: 'Article.headline' }), field('author', 'Author', false, { schemaOrgPath: 'Article.author.name' }), field('price', 'Price', false)]) => ({
  schemaVersion: 1,
  projects: [{ id: 'articles', name: 'Articles', scope: { allSites: true, domains: [] }, fields, siteMappings: {}, targets }],
});
const target = (id: string, name: string, url: string) => ({ id, name, url, headers: [], purpose: '' });

/** Answers /slow only after release() so the sending state stays on screen. */
function slowServer(): Promise<{ url: string; release(): void; close(): void }> {
  const pending: (() => void)[] = [];
  const server: Server = createServer((_req, res) => {
    pending.push(() => res.writeHead(200, { 'content-type': 'application/json' }).end('{}'));
  });
  return new Promise((ok) =>
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      ok({
        url: `http://localhost:${port}/slow`,
        release: () => pending.splice(0).forEach((f) => f()),
        close: () => {
          server.closeAllConnections();
          server.close();
        },
      });
    }),
  );
}

async function shot(popup: Page, name: string, tag: string, height = 200) {
  await popup.setViewportSize({ width: 384, height });
  await popup.screenshot({ path: join(OUT, `${tag}-${name}.png`), fullPage: true });
}

for (const lang of ['de', 'en'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`popup screens ${lang} ${theme}`, async ({ context, serviceWorker, extensionId, pages, webhook }) => {
      const tag = `${theme}-${lang}`;
      await serviceWorker.evaluate((settings) => chrome.storage.local.set({ settings }), { language: lang, appearance: theme });
      const slow = await slowServer();
      const page = await context.newPage();
      await page.goto(`${pages.origin}/jsonld.html`);
      const open = async () => {
        const popup = await openPopup(context, serviceWorker, extensionId, page);
        await popup.getByRole('main').waitFor();
        return popup;
      };
      // The e2e build is granted localhost; an unrelated host stays without permission.
      const ok = target('ok', 'Test hook', webhook.url);

      // Form with detected, hand-entered and empty values.
      await setConfig(serviceWorker, project([ok]));
      let popup = await open();
      await expect(popup.getByRole('textbox').first()).not.toHaveValue('');
      await popup.getByRole('textbox', { name: /Price|Preis/ }).fill('12,50');
      await shot(popup, 'form', tag);

      // Field menu open (it is fixed and clamped into the window, so the window must be tall enough to review it).
      const menuButton = popup.getByRole('button', { name: /^(Options for|Optionen für) Price$/ });
      await popup.setViewportSize({ width: 384, height: 600 });
      await menuButton.click();
      await expect(popup.getByRole('menu')).toBeVisible();
      await shot(popup, 'field-menu', tag, 600);
      await popup.keyboard.press('Escape');
      await expect(menuButton).toBeFocused();

      // Long Markdown value: input capped at five lines with fade and "Show more", then the preview.
      const longValue = ['## Product details', '**Lightweight** and durable.', '- Water resistant', '- Two year warranty', '- Available in three sizes', '- Free returns within 30 days', '- Made from recycled material', 'See the full description on the product page.'].join('\n');
      await popup.getByRole('textbox', { name: /Price|Preis/ }).fill(longValue);
      const more = popup.getByRole('button', { name: /Show more|Mehr anzeigen/ });
      await expect(more).toBeVisible();
      // Show the start of the value, as the popup does when it opens.
      await popup.getByRole('textbox', { name: /Price|Preis/ }).evaluate((el) => {
        el.scrollTop = 0;
        el.blur();
      });
      await shot(popup, 'long-value', tag);
      await more.click();
      await expect(popup.getByRole('dialog')).toBeVisible();
      await expect(popup.getByRole('dialog').locator('strong')).toBeVisible();
      await shot(popup, 'long-value-preview', tag, 700);
      await popup.getByRole('button', { name: /^(Edit|Bearbeiten)$/ }).click();
      await shot(popup, 'long-value-edit', tag, 700);
      await popup.keyboard.press('Escape');
      await expect(more).toBeFocused();

      // Project choice open and a search without hits: matching, unfoldered and foldered projects with tags.
      // The list is clamped into the window, so the window must be tall enough to review it.
      await popup.close();
      const named = (id: string, name: string, extra: object) => ({ ...project([target(`t-${id}`, 'Test hook', webhook.url)]).projects[0], id, name, ...extra });
      const elsewhere = { allSites: false, domains: ['other.example'] };
      await setConfig(serviceWorker, {
        schemaVersion: 1,
        folders: [{ id: 'f1', name: 'Reviews' }, { id: 'f2', name: 'Shop' }],
        tags: [{ id: 't1', name: 'news' }, { id: 't2', name: 'draft' }],
        projects: [
          named('articles', 'Articles', { tagIds: ['t1'] }),
          named('notes', 'Notes', { scope: elsewhere }),
          named('books', 'Books', { scope: elsewhere, folderId: 'f1', tagIds: ['t2'] }),
          named('films', 'Films', { scope: elsewhere, folderId: 'f1' }),
          named('products', 'Products', { scope: elsewhere, folderId: 'f2' }),
        ],
      });
      popup = await open();
      const choice = popup.getByRole('combobox', { name: /^(Project|Projekt)$/ });
      await popup.setViewportSize({ width: 384, height: 480 });
      await choice.click();
      await expect(popup.getByRole('listbox')).toBeVisible();
      await expect(popup.getByRole('option')).toHaveCount(5);
      await shot(popup, 'project-choice', tag, 480);
      await choice.fill('zzz');
      await expect(popup.getByRole('status').filter({ hasText: /^(Keine Treffer|No matches)$/ })).toBeVisible();
      await shot(popup, 'project-choice-empty', tag, 480);
      await popup.keyboard.press('Escape');
      await expect(popup.getByRole('listbox')).toBeHidden();
      await expect(choice).toHaveValue(/^Articles/);
      // Device sort Z–A: the groups are sorted in themselves, the preselection stays.
      const setSort = (projectSort: string) =>
        serviceWorker.evaluate(async (value) => {
          const { settings } = (await chrome.storage.local.get('settings')) as { settings?: object };
          await chrome.storage.local.set({ settings: { ...settings, projectSort: value } });
        }, projectSort);
      await setSort('nameDesc');
      await choice.click();
      await expect(popup.getByRole('option').nth(0)).toContainText('Articles');
      await expect(popup.getByRole('option').nth(1)).toContainText('Notes');
      await shot(popup, 'project-choice-sorted', tag, 480);
      await popup.keyboard.press('Escape');
      await expect(choice).toHaveValue(/^Articles/);
      await setSort('manual');

      // Sending.
      await popup.close();
      await setConfig(serviceWorker, project([target('slow', 'Test hook', slow.url)]));
      popup = await open();
      await popup.getByRole('button', { name: /Test hook/ }).click();
      await expect(popup.getByRole('button', { name: /^(Sending to|Wird an)/ })).toBeDisabled();
      await shot(popup, 'sending', tag);
      slow.release();
      await expect(popup.getByRole('status').filter({ hasText: /(Gesendet|Sent)/ })).toBeVisible();
      await popup.close();

      // Success with link.
      await setConfig(serviceWorker, project([ok]));
      popup = await open();
      await popup.getByRole('button', { name: /Test hook/ }).click();
      await expect(popup.getByRole('link')).toBeVisible();
      await shot(popup, 'success', tag);
      await popup.close();

      // Two targets: the split button with its menu open (name and shortened address, no query string).
      const chooseTarget = (popup_: Page) => popup_.getByRole('button', { name: /^(Choose target to send to|Ziel zum Senden wählen)$/ });
      await setConfig(serviceWorker, project([ok, target('second', 'Second hook', 'https://hooks.example.com/api/in?token=SECRET')]));
      popup = await open();
      await popup.setViewportSize({ width: 384, height: 600 });
      await chooseTarget(popup).click();
      await expect(popup.getByRole('menu')).toBeVisible();
      await expect(popup.getByRole('menuitem')).toHaveCount(2);
      await expect(popup.getByRole('menu')).not.toContainText('SECRET');
      await shot(popup, 'two-targets-menu', tag, 600);
      await popup.keyboard.press('Escape');
      await popup.close();

      // HTTP error and unreachable target: the result of the latest send stands under the head.
      await setConfig(serviceWorker, project([target('err', 'Error hook', webhook.errorUrl), target('down', 'Offline hook', 'http://localhost:9/none')]));
      popup = await open();
      await chooseTarget(popup).click();
      await popup.getByRole('menuitem', { name: /Error hook/ }).click();
      await expect(popup.getByRole('alert')).toContainText('Error hook');
      await shot(popup, 'error', tag);
      await chooseTarget(popup).click();
      await popup.getByRole('menuitem', { name: /Offline hook/ }).click();
      await expect(popup.getByRole('alert')).toContainText('Offline hook');
      await shot(popup, 'error-offline', tag);
      await popup.close();

      // Many fields, scrolled down: the head stays at the top.
      const many = Array.from({ length: 16 }, (_, i) => field(`f${i}`, `Field ${i + 1}`, false));
      await setConfig(serviceWorker, project([ok], many));
      popup = await open();
      await expect(popup.getByRole('textbox', { name: 'Field 16' })).toBeVisible();
      await popup.setViewportSize({ width: 384, height: 420 });
      await popup.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await expect.poll(() => popup.evaluate(() => window.scrollY)).toBeGreaterThan(200);
      expect((await popup.locator('header.popup-header').boundingBox())!.y).toBeLessThanOrEqual(1);
      await popup.screenshot({ path: join(OUT, `${tag}-scrolled.png`) });
      await popup.close();

      // Missing permission.
      await setConfig(serviceWorker, project([target('far', 'Remote hook', 'https://hooks.example.com/in')]));
      popup = await open();
      await popup.getByRole('button', { name: /Remote hook/ }).click();
      await expect(popup.getByRole('alert')).toContainText('Remote hook');
      await shot(popup, 'no-permission', tag);
      await popup.close();

      // Missing required fields.
      const plain = await context.newPage();
      await plain.goto(`${pages.origin}/plain-1.html`);
      await setConfig(serviceWorker, project([ok]));
      popup = await openPopup(context, serviceWorker, extensionId, plain);
      await popup.getByRole('button', { name: /Test hook/ }).click();
      await expect(popup.getByRole('alert').first()).toBeVisible();
      await shot(popup, 'missing-fields', tag);
      await popup.close();
      await plain.close();

      // No target.
      await setConfig(serviceWorker, project([]));
      popup = await open();
      await expect(popup.getByRole('button').last()).toBeVisible();
      await shot(popup, 'no-target', tag);
      await popup.close();

      // No projects.
      await setConfig(serviceWorker, { schemaVersion: 1, projects: [] });
      popup = await open();
      await expect(popup.getByRole('button')).toBeVisible();
      await shot(popup, 'no-projects', tag);
      await popup.close();

      // Mapped elements framed on the page, and the header with the switch on and off.
      const framed = await context.newPage();
      await framed.setViewportSize({ width: 1000, height: 640 });
      await framed.emulateMedia({ colorScheme: theme });
      await framed.goto(`${pages.origin}/picker-${theme}.html`);
      const mapped = project([ok], [field('headline', 'Headline', true), field('price', 'Price', false)]);
      mapped.projects[0]!.siteMappings = { '127.0.0.1': { headline: '#headline', price: '#price' } } as never;
      await setConfig(serviceWorker, mapped);
      popup = await openPopup(context, serviceWorker, extensionId, framed);
      await expect(framed.locator('.frame .label')).toHaveCount(2);
      await framed.screenshot({ path: join(OUT, `${tag}-highlight-page.png`) });
      await shot(popup, 'highlight-on', tag);
      // Every field is click-mapped here: the picker buttons all show the mapped motif.
      await expect(popup.getByRole('button', { name: /(Assigned by click|Per Klick zugeordnet)/ })).toHaveCount(2);
      await shot(popup, 'all-mapped', tag);
      await popup.getByRole('button', { name: /^(Highlight mapped|Zugeordnete Elemente)/ }).click();
      await expect(framed.locator('.frame')).toHaveCount(0);
      await shot(popup, 'highlight-off', tag);
      await popup.getByRole('button', { name: /^(Highlight mapped|Zugeordnete Elemente)/ }).click();
      await popup.close();
      await framed.close();

      // Unreadable page.
      const internal = await context.newPage();
      await internal.goto('chrome://version/');
      await setConfig(serviceWorker, project([ok]));
      await internal.bringToFront();
      // Without the tabs permission the URL of a browser page is hidden, so the tab is found by being active.
      const tabId = await serviceWorker.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id);
      popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup.html?tabId=${tabId}`);
      await expect(popup.getByRole('alert')).toBeVisible();
      await shot(popup, 'unreadable', tag);
      await popup.close();
      await internal.close();
      slow.close();
    });
  }
}
