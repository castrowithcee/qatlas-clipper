import type { Locator, Page } from '@playwright/test';
import { expect, openPopup, setConfig, test } from '../fixtures';

async function expectTooltipInsideWindow(popup: Page, trigger: Locator, text: string) {
  await trigger.hover();
  const tip = popup.getByRole('tooltip').filter({ hasText: text });
  await expect(tip).toBeVisible();
  const inside = await popup.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  expect(inside.scroll).toBeLessThanOrEqual(inside.width);
  const box = (await tip.boundingBox())!;
  const view = popup.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(view.width);
  expect(box.y + box.height).toBeLessThanOrEqual(view.height);
  // The tooltip must stay open: a layout change on open would move the pointer off the trigger.
  await popup.waitForTimeout(300);
  await expect(tip).toBeVisible();
}

test('tooltips at the right edge stay inside the popup window', async ({ context, serviceWorker, extensionId, pages, webhook }) => {
  await setConfig(serviceWorker, {
    schemaVersion: 1,
    projects: [
      {
        id: 'articles',
        name: 'Articles',
        scope: { allSites: true, domains: [] },
        fields: [{ key: 'headline', label: 'Headline', required: true, sources: { schemaOrgPath: 'Article.headline' } }],
        siteMappings: {},
        targets: [{ id: 'hook', name: 'Test hook', url: webhook.url, headers: [], purpose: 'e2e' }],
      },
    ],
  });
  const page = await context.newPage();
  await page.goto(`${pages.origin}/jsonld.html`);
  const popup = await openPopup(context, serviceWorker, extensionId, page);
  // Popup-like window size, so the right edge is close to the triggers.
  await popup.setViewportSize({ width: 384, height: 600 });
  await expect(popup.getByRole('textbox', { name: 'Headline' })).toHaveValue('Example Headline');

  await expectTooltipInsideWindow(popup, popup.getByRole('button', { name: 'Open settings' }), 'Open settings');
  await expectTooltipInsideWindow(popup, popup.getByRole('img', { name: 'Detected automatically' }), 'Detected automatically');
});
