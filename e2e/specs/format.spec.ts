import { expect, openPopup, setConfig, test } from '../fixtures';

test('a contact block mapped by click reaches the webhook as Markdown with line breaks', async ({ context, serviceWorker, extensionId, pages, webhook }) => {
  await setConfig(serviceWorker, {
    schemaVersion: 1,
    projects: [
      {
        id: 'contacts',
        name: 'Contacts',
        scope: { allSites: true, domains: [] },
        fields: [{ key: 'contact', label: 'Contact', required: true, format: 'markdown', sources: {} }],
        siteMappings: {},
        targets: [{ id: 'hook', name: 'Test hook', url: webhook.url, headers: [], purpose: 'e2e' }],
      },
    ],
  });

  const page = await context.newPage();
  await page.goto(`${pages.origin}/contact.html`);
  let popup = await openPopup(context, serviceWorker, extensionId, page);
  await popup.getByRole('button', { name: 'Click Contact on the page' }).click();
  await popup.waitForEvent('close');
  await expect(page.getByText('Choose element for "Contact"')).toBeVisible();
  // Click the padding so the block itself, not a line inside it, is chosen.
  await page.locator('#contact').click({ position: { x: 4, y: 4 } });
  await expect(page.getByText('Saved for 127.0.0.1')).toBeVisible();

  popup = await openPopup(context, serviceWorker, extensionId, page);
  const area = popup.getByRole('textbox', { name: /Contact/ });
  await expect(area).toHaveValue(/\*\*Ansprechpartner\*\*/);
  const shown = await area.inputValue();
  expect(shown).toContain('\n');
  expect(shown).not.toContain('Hidden internal note');

  await popup.getByRole('button', { name: 'Send to Test hook' }).click();
  await expect(popup.getByText(/^Sent at /)).toBeVisible();
  expect(webhook.requests).toHaveLength(1);
  const value = ((webhook.requests[0]!.body as { fields: Record<string, string> }).fields).contact!;
  expect(value).toBe('**Ansprechpartner**\n\nErika Beispiel\n\nLeitung Einkauf\n\nTelefon 0000\n\n[info@example.com](mailto:info@example.com)');
  expect(value).not.toContain('Hidden');
});
