import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const OUT = resolve(process.env.SCREENS_DIR ?? 'test-results/screens');
mkdirSync(OUT, { recursive: true });

const SECTIONS = ['buttons', 'fields', 'toggles', 'tooltip', 'toasts', 'states', 'disclosure', 'table', 'chips', 'tiles', 'combobox', 'menu', 'split', 'icons'];

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

    test('tile group focus', async ({ page }) => {
      await open(page, theme);
      const tiles = page.getByTestId('tiles');
      await tiles.getByRole('radio', { name: 'Light' }).focus();
      await page.keyboard.press('ArrowRight');
      const outline = await tiles.locator('.q-tile-input:focus-visible + .q-tile-body').evaluate((el) => getComputedStyle(el).outlineStyle);
      expect(outline).toBe('solid');
      await tiles.screenshot({ path: join(OUT, `${theme}-focus-tiles.png`) });
    });

    test('detail panel wide and narrow', async ({ page }) => {
      await open(page, theme);
      const open1 = page.getByTestId('row-open-Summary');
      for (const [name, width] of [['wide', 1280], ['narrow', 400]] as const) {
        await page.setViewportSize({ width, height: 800 });
        await open1.focus();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('dialog')).toBeVisible();
        const box = await page.getByRole('dialog').boundingBox();
        if (name === 'narrow') expect(box!.width).toBe(width);
        else expect(box!.x + box!.width).toBe(width);
        await page.screenshot({ path: join(OUT, `${theme}-panel-${name}.png`) });
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toBeHidden();
        await expect(open1).toBeFocused();
      }
    });

    test('combobox open and without matches', async ({ page }) => {
      await open(page, theme);
      const box = page.getByRole('combobox', { name: 'Project' });
      // Top of the window, so the list opens below the input.
      await page.getByTestId('combobox').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await box.focus();
      await expect(page.getByRole('listbox', { name: 'Projects' })).toBeVisible();
      await expect(page.getByRole('option', { name: 'Articles · News' })).toHaveAttribute('aria-selected', 'true');
      const top = (await page.getByTestId('combobox').boundingBox())!.y;
      await page.screenshot({ clip: { x: 0, y: top, width: 480, height: 400 }, path: join(OUT, `${theme}-combobox-open.png`) });
      await page.keyboard.type('zzz');
      await expect(page.getByText('No matches')).toBeVisible();
      await page.screenshot({ clip: { x: 0, y: top, width: 480, height: 200 }, path: join(OUT, `${theme}-combobox-empty.png`) });
      await page.keyboard.press('Escape');
      await expect(page.getByRole('listbox')).toBeHidden();
      await expect(box).toHaveValue('Articles · News');
    });

    test('menu open', async ({ page }) => {
      await open(page, theme);
      for (const id of ['menu-default', 'menu-custom']) {
        await page.getByTestId(id).focus();
        await page.keyboard.press('ArrowDown');
        await expect(page.getByRole('menu')).toBeVisible();
        await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(page.getByRole('menuitemcheckbox', { name: 'Required' })).toBeFocused();
        await page.screenshot({ clip: { x: 0, y: (await page.getByTestId('menu').boundingBox())!.y, width: 400, height: 330 }, path: join(OUT, `${theme}-${id}-open.png`) });
        await page.keyboard.press('Escape');
        await expect(page.getByRole('menu')).toBeHidden();
        await expect(page.getByTestId(id)).toBeFocused();
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
