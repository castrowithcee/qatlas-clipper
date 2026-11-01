import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Page, Worker } from '@playwright/test';
import { expect, setConfig, tabIdOf, test } from '../fixtures';

// Must match PICKER_GLOBAL in entrypoints/picker.ts.
const PICKER_GLOBAL = '__qatlasPickerStart';

const project = {
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

interface Settings {
  language: 'auto' | 'de' | 'en';
  appearance: 'system' | 'light' | 'dark';
}

async function startPicker(worker: Worker, page: Page, settings: Settings): Promise<void> {
  await worker.evaluate((s) => chrome.storage.local.set({ settings: s }), settings);
  const tabId = await tabIdOf(worker, page);
  await worker.evaluate(
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
}

const mappings = (worker: Worker) =>
  worker.evaluate(async () => {
    const { config } = (await chrome.storage.local.get('config')) as { config: { projects: { siteMappings: unknown }[] } };
    return config.projects[0]!.siteMappings;
  });

// Page rules that would wreck any unprotected overlay: reset everything, recolor, enlarge, and target button and div directly.
const HOSTILE_CSS = `
  * { all: unset !important; color: red !important; font-size: 40px !important; }
  div, button, svg { display: none !important; position: static !important; background: red !important; }
  body { display: block !important; }
`;

test.beforeEach(async ({ serviceWorker }) => {
  await setConfig(serviceWorker, project);
});

test('hostile page styles do not change the overlay, and Apply saves the mapping', async ({ context, serviceWorker, pages }) => {
  const page = await context.newPage();
  await page.goto(`${pages.origin}/picker-light.html`);
  await page.addStyleTag({ content: HOSTILE_CSS });
  await startPicker(serviceWorker, page, { language: 'en', appearance: 'light' });

  const title = page.getByText('Choose element for "Price"');
  await expect(title).toBeVisible();
  const apply = page.getByRole('button', { name: 'Apply' });
  const style = await apply.evaluate((el) => {
    const cs = getComputedStyle(el);
    const host = (el.getRootNode() as ShadowRoot).host;
    const hs = getComputedStyle(host);
    return { fontSize: cs.fontSize, color: cs.color, height: el.getBoundingClientRect().height, hostPosition: hs.position, hostDisplay: hs.display };
  });
  expect(style.fontSize).toBe('14px');
  expect(style.color).not.toBe('rgb(255, 0, 0)');
  expect(style.height).toBeLessThan(60);
  expect(style.hostPosition).toBe('fixed');
  expect(style.hostDisplay).toBe('block');
  expect(await title.evaluate((el) => getComputedStyle(el).fontSize)).toBe('14px');

  await page.locator('#price').click();
  await expect(page.locator('.preview-text')).toHaveText('10.00');
  await apply.click();
  await expect(page.getByText('Mapping saved')).toBeVisible();
  await expect(title).toHaveCount(0);
  expect(await mappings(serviceWorker)).toEqual({ '127.0.0.1': { price: '#price' } });
});

test('German dark overlay: hint for a non-unique element, selector only in the tooltip, Esc cancels', async ({
  context,
  serviceWorker,
  pages,
}) => {
  const page = await context.newPage();
  await page.goto(`${pages.origin}/picker-light.html`);
  await startPicker(serviceWorker, page, { language: 'de', appearance: 'dark' });

  await expect(page.getByText('Element für „Price“ wählen')).toBeVisible();
  expect(await page.locator('.bar').evaluate((el) => (el.getRootNode() as ShadowRoot).host.getAttribute('data-theme'))).toBe('dark');

  await page.locator('li span').first().click();
  await expect(page.getByText('Dieses Element ist nicht eindeutig. Wähle ein anderes.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Übernehmen' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Technische Details' })).toBeHidden();

  await page.locator('#price').click();
  const details = page.getByRole('button', { name: 'Technische Details' });
  await expect(details).toBeVisible();
  await details.focus();
  await expect(page.getByRole('tooltip').filter({ hasText: '#price' })).toBeVisible();

  await page.getByRole('button', { name: 'Tastaturhinweis' }).focus();
  await expect(page.getByRole('tooltip').filter({ hasText: 'Esc bricht ab' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByText('Element für')).toHaveCount(0);
  expect(await mappings(serviceWorker)).toEqual({});
});

test('Cancel closes without saving', async ({ context, serviceWorker, pages }) => {
  const page = await context.newPage();
  await page.goto(`${pages.origin}/picker-dark.html`);
  await startPicker(serviceWorker, page, { language: 'en', appearance: 'system' });
  await page.locator('#price').click();
  await expect(page.getByRole('button', { name: 'Apply' })).toBeEnabled();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('Choose element for')).toHaveCount(0);
  expect(await mappings(serviceWorker)).toEqual({});
});

// Screenshots for the visual review: only with SCREENS_DIR set, never part of the regular run.
const SCREENS_DIR = process.env.SCREENS_DIR;
test.describe('screenshots', () => {
  test.skip(!SCREENS_DIR, 'set SCREENS_DIR to take screenshots');
  test('overlay on light and dark pages in German and English', async ({ context, serviceWorker, pages }) => {
    const out = resolve(SCREENS_DIR!);
    mkdirSync(out, { recursive: true });
    const page = await context.newPage();
    await page.setViewportSize({ width: 1000, height: 640 });
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      for (const language of ['de', 'en'] as const) {
        const name = `${theme}-${language}`;
        await page.goto(`${pages.origin}/picker-${theme}.html`);
        await startPicker(serviceWorker, page, { language, appearance: 'system' });
        await expect(page.locator('.bar')).toBeVisible();
        await page.locator('#headline').hover();
        await page.screenshot({ path: join(out, `${name}-hover.png`) });
        await page.locator('#price').click();
        await page.waitForTimeout(250);
        await page.screenshot({ path: join(out, `${name}-unique.png`) });
        await page.locator('.tipwrap button').nth(1).focus();
        await page.waitForTimeout(250);
        await page.screenshot({ path: join(out, `${name}-unique-details.png`) });
        await page.locator('li span').first().click();
        await page.waitForTimeout(250);
        await page.screenshot({ path: join(out, `${name}-not-unique.png`) });
        await page.locator('.tipwrap button').first().focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        await page.waitForTimeout(250);
        await page.screenshot({ path: join(out, `${name}-not-unique-keyhint.png`) });
        await page.locator('#price').click();
        await page.locator('.confirm').focus();
        await page.waitForTimeout(250);
        await page.screenshot({ path: join(out, `${name}-focus-apply.png`) });
      }
    }
  });
});
