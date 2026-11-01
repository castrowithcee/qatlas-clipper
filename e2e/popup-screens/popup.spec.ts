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

async function shot(popup: Page, name: string, tag: string) {
  await popup.setViewportSize({ width: 384, height: 200 });
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

      // Sending.
      await popup.close();
      await setConfig(serviceWorker, project([target('slow', 'Test hook', slow.url)]));
      popup = await open();
      await popup.getByRole('button', { name: /Test hook/ }).click();
      await expect(popup.getByRole('button', { name: /…/ })).toBeDisabled();
      await shot(popup, 'sending', tag);
      slow.release();
      await expect(popup.getByRole('status').filter({ hasText: /^(Gesendet|Sent)/ })).toBeVisible();
      await popup.close();

      // Success with link.
      await setConfig(serviceWorker, project([ok]));
      popup = await open();
      await popup.getByRole('button', { name: /Test hook/ }).click();
      await expect(popup.getByRole('link')).toBeVisible();
      await shot(popup, 'success', tag);
      await popup.close();

      // HTTP error and unreachable target, two targets in one popup.
      await setConfig(serviceWorker, project([target('err', 'Error hook', webhook.errorUrl), target('down', 'Offline hook', 'http://localhost:9/none')]));
      popup = await open();
      await popup.getByRole('button', { name: /Error hook/ }).click();
      await popup.getByRole('button', { name: /Offline hook/ }).click();
      await expect(popup.getByRole('alert')).toHaveCount(2);
      await shot(popup, 'error', tag);
      await popup.close();

      // Missing permission.
      await setConfig(serviceWorker, project([target('far', 'Remote hook', 'https://hooks.example.com/in')]));
      popup = await open();
      await popup.getByRole('button', { name: /Remote hook/ }).click();
      await expect(popup.getByRole('alert')).toBeVisible();
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
