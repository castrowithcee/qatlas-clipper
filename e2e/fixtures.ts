import { test as base, chromium, expect, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startPages, startWebhook, type TestPages, type TestWebhook } from './servers';

export { expect };

/** Built e2e variant; see `npm run build:e2e`. */
export const EXTENSION_DIR = resolve(import.meta.dirname, '../.output/chrome-mv3-e2e');

interface Fixtures {
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
  pages: TestPages;
  webhook: TestWebhook;
}

export const test = base.extend<Fixtures>({
  pages: async ({}, use) => {
    const pages = await startPages();
    await use(pages);
    await pages.close();
  },
  webhook: async ({}, use) => {
    const webhook = await startWebhook();
    await use(webhook);
    await webhook.close();
  },
  context: async ({}, use) => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'qatlas-clipper-e2e-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`],
    });
    await use(context);
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
  },
  serviceWorker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(worker);
  },
  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },
});

/** Replace the extension config (and optionally header values) in chrome.storage.local. */
export async function setConfig(worker: Worker, config: unknown, headerValues: unknown = {}): Promise<void> {
  await worker.evaluate(
    ([c, h]) => chrome.storage.local.set({ config: c, headerValues: h }),
    [config, headerValues] as const,
  );
}

/** Chrome tab id of the tab showing `page` (queried through the service worker by URL). */
export async function tabIdOf(worker: Worker, page: Page): Promise<number> {
  const url = page.url();
  const id = await worker.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id, url);
  if (id === undefined) throw new Error(`No tab found for ${url}`);
  return id;
}

/** Open the popup in its own page, bound to the tab of `target` (works only in the e2e build). */
export async function openPopup(context: BrowserContext, worker: Worker, extensionId: string, target: Page): Promise<Page> {
  const tabId = await tabIdOf(worker, target);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html?tabId=${tabId}`);
  return popup;
}
