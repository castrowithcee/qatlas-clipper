import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const OUT = resolve(process.env.SCREENS_DIR ?? 'test-results/screens');
mkdirSync(OUT, { recursive: true });

const SECTIONS = ['buttons', 'fields', 'toggles', 'tooltip', 'toasts', 'states', 'disclosure', 'icons'];

async function open(page: Page, theme: string, lang = 'en') {
  await page.goto(`/?theme=${theme}&lang=${lang}`);
  await expect(page.getByTestId('buttons')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

for (const theme of ['light', 'dark']) {
  test.describe(theme, () => {
    test('components at rest', async ({ page }) => {
      await open(page, theme);
      for (const id of SECTIONS) await page.getByTestId(id).screenshot({ path: join(OUT, `${theme}-${id}.png`) });
    });

    test('keyboard focus states', async ({ page }) => {
      await open(page, theme);
      // Tab through the fields section: every stop must show the focus outline from the token.
      await page.getByTestId('buttons').locator('button').first().focus();
      for (const id of ['buttons', 'fields', 'toggles', 'disclosure']) {
        const section = page.getByTestId(id);
        await section.locator('button, input, select').first().focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
        expect(outline, id).toBe('solid');
        await section.screenshot({ path: join(OUT, `${theme}-focus-${id}.png`) });
      }
    });

    test('tooltip open by keyboard and dialog', async ({ page }) => {
      await open(page, theme);
      await page.getByTestId('tooltip-trigger').focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(page.getByRole('tooltip')).toBeVisible();
      await page.getByTestId('tooltip').screenshot({ path: join(OUT, `${theme}-tooltip-open.png`) });
      await page.keyboard.press('Escape');
      await expect(page.getByRole('tooltip')).toBeHidden();

      await page.getByTestId('dialog-open').click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.screenshot({ path: join(OUT, `${theme}-dialog.png`) });
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();
      await expect(page.getByTestId('dialog-open')).toBeFocused();
    });
  });
}

test('german catalog in the gallery', async ({ page }) => {
  await open(page, 'light', 'de');
  await page.getByTestId('disclosure').screenshot({ path: join(OUT, 'light-de-disclosure.png') });
  await page.getByTestId('states').screenshot({ path: join(OUT, 'light-de-states.png') });
});
