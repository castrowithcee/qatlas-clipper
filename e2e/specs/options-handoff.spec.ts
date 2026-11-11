import { expect, openPopup, setConfig, test } from '../fixtures';

const project = (id: string, name: string) => ({
  id,
  name,
  scope: { allSites: true, domains: [] },
  fields: [{ key: 'headline', label: 'Headline', required: false, sources: { schemaOrgPath: 'Article.headline' } }],
  siteMappings: {},
  targets: [],
});

test('the popup gear reuses the open options tab, shows the selected project and keeps the draft', async ({
  context,
  serviceWorker,
  extensionId,
  pages,
}) => {
  await setConfig(serviceWorker, { schemaVersion: 1, projects: [project('first', 'First'), project('second', 'Second')] });

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(options).toHaveTitle('Qatlas Clipper');
  await expect(options.getByRole('heading', { name: 'Qatlas Clipper', level: 1 })).toBeVisible();
  await expect(options.getByLabel('Project name')).toHaveValue('First');
  // Unsaved change in the first project.
  await options.getByLabel('Project name').fill('First edited');

  const page = await context.newPage();
  await page.goto(`${pages.origin}/jsonld.html`);
  const popup = await openPopup(context, serviceWorker, extensionId, page);
  await popup.getByRole('combobox', { name: 'Project' }).click();
  await popup.getByRole('option', { name: 'Second' }).click();
  const optionsPages = () => context.pages().filter((p) => p.url().startsWith(`chrome-extension://${extensionId}/options.html`));
  expect(optionsPages()).toHaveLength(1);
  await popup.getByRole('button', { name: 'Open settings' }).click();

  await expect(options.getByLabel('Project name')).toHaveValue('Second');
  expect(options.url()).toContain('#/projects/second');
  // No second options tab, and the unsaved edit of the first project is still in the draft.
  expect(optionsPages()).toHaveLength(1);
  await expect(options.getByRole('navigation', { name: 'Options' }).getByRole('link', { name: 'First edited' })).toBeVisible();
});
