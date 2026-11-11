// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CONFIG_KEY, HEADER_VALUES_KEY, exportConfig, loadConfig, type StorageArea } from '../src/config';
import type { PermissionsApi } from '../src/options/permissions';
import { OptionsApp } from '../src/options/OptionsApp';
import { parseHash, projectHash } from '../src/options/route';
import { OPTIONS_FOCUS_KEY, type FocusChannel } from '../src/options/focus';
import { SettingsProvider, SETTINGS_KEY } from '../src/settings';
import { de, en } from '../src/i18n/catalog';

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

function fakeStorage(initial: Record<string, unknown> = {}): StorageArea & { data: Record<string, unknown> } {
  const data = { ...initial };
  return {
    data,
    get: async (keys) => Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, structuredClone(data[k])])),
    set: async (items) => void Object.assign(data, structuredClone(items)),
  };
}

const project = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, name, scope: { allSites: true, domains: [] }, fields: [], siteMappings: {}, targets: [], ...extra,
});
const stored = (...projects: unknown[]) => ({ [CONFIG_KEY]: { schemaVersion: 1, projects } });

function fakePermissions(grant = true) {
  const granted = new Set<string>();
  const api = {
    contains: vi.fn(async (o: string[]) => o.every((x) => granted.has(x))),
    request: vi.fn(async (o: string[]) => {
      if (grant) o.forEach((x) => granted.add(x));
      return grant;
    }),
    remove: vi.fn(async (o: string[]) => {
      o.forEach((x) => granted.delete(x));
      return true;
    }),
  } satisfies PermissionsApi;
  return Object.assign(api, { granted });
}

async function mount(storage: StorageArea, permissions: PermissionsApi = fakePermissions(), hash = '') {
  const user = userEvent.setup();
  window.location.hash = hash;
  render(<OptionsApp storage={storage} permissions={permissions} />);
  await screen.findByRole('navigation', { name: 'Options' });
  return user;
}

const IMPORT_EXPORT = '#/import-export';
const titleMenu = async (user: ReturnType<typeof userEvent.setup>, entry: string) => {
  await user.click(screen.getByRole('button', { name: 'Options for projects' }));
  await user.click(screen.getByRole('menuitem', { name: entry }));
};
// Menu on the title of the open project in the main area.
const headMenu = async (user: ReturnType<typeof userEvent.setup>, name: string, entry: string) => {
  await user.click(within(screen.getByRole('main')).getByRole('button', { name: `Options for project ${name}` }));
  await user.click(screen.getByRole('menuitem', { name: entry }));
};
const addButton = () => within(screen.getByRole('main')).getByRole('button', { name: 'Add project' });

const addField = async (user: ReturnType<typeof userEvent.setup>, label: string) => {
  await user.type(screen.getByLabelText('Label of the new field'), label);
  await user.click(screen.getByRole('button', { name: 'Add field' }));
};

/** The details of a field, opened from its row. */
const openDetails = async (user: ReturnType<typeof userEvent.setup>, name: string, n = 0) => {
  await user.click(screen.getAllByRole('button', { name: `Edit field ${name}` })[n]!);
  return within(screen.getByRole('dialog', { name }));
};

const closeDetails = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
};

const addSite = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
  await user.type(screen.getByLabelText('Add website'), text);
  await user.click(screen.getByRole('button', { name: 'Add' }));
};

describe('options page', () => {
  it('creates a project with scope and field and persists it across re-mount', async () => {
    const storage = fakeStorage();
    const user = await mount(storage);
    expect(screen.getByText('No project yet')).toBeTruthy();
    await user.click(addButton());
    const name = screen.getByLabelText('Project name');
    await user.clear(name);
    await user.type(name, 'Articles');
    await user.click(screen.getByRole('radio', { name: 'Specific websites' }));
    await addSite(user, 'example.com');
    await addSite(user, 'example.org');
    await user.click(screen.getByRole('button', { name: 'Remove website example.org' }));
    await user.selectOptions(screen.getByLabelText('Only on pages of this kind'), 'article');
    await user.type(screen.getByLabelText('Custom page type'), 'Article');
    expect(screen.queryByLabelText('Regular expression')).toBeNull();
    await addField(user, 'Status');
    // Adding a field opens its details.
    const field = screen.getByRole('dialog', { name: 'Status' });
    await user.click(within(field).getByRole('button', { name: 'Advanced' }));
    await user.type(within(field).getByLabelText('Custom schema.org path'), 'Article.headline');
    await user.selectOptions(within(field).getByLabelText('Where does the value come from?'), 'manual');
    await user.selectOptions(within(field).getByLabelText('Kind of input'), 'choice');
    await user.type(within(field).getByLabelText('Add value'), 'Draft{Enter}Final{Enter}');
    await closeDetails(user);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Saved.');

    cleanup();
    await mount(storage);
    expect(screen.getByRole('button', { name: 'Remove website example.com' })).toBeTruthy();
    const saved = await loadConfig(storage);
    expect(saved.projects[0]?.scope).toEqual({ allSites: false, domains: ['example.com'], pageKind: 'article', pageType: 'Article' });
    expect(saved.projects[0]?.fields[0]?.sources).toEqual({
      schemaOrgPath: 'Article.headline',
      manual: { type: 'choice', values: ['Draft', 'Final'] },
    });
  });

  it('offers the content format with Markdown as the default for new projects and saves the choice', async () => {
    const storage = fakeStorage();
    const user = await mount(storage);
    await user.click(addButton());
    const select = screen.getByLabelText('Send page content') as HTMLSelectElement;
    expect(select.value).toBe('markdown');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Off', 'Markdown', 'HTML']);
    await user.selectOptions(select, 'html');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Saved.');
    expect((await loadConfig(storage)).projects[0]?.content).toBe('html');
  });

  it('shows a stored project without the setting as Markdown', async () => {
    await mount(fakeStorage(stored(project('a', 'Alpha'))), undefined, projectHash('a'));
    expect((screen.getByLabelText('Send page content') as HTMLSelectElement).value).toBe('markdown');
  });

  it('renames a project in the list and the project view', async () => {
    const storage = fakeStorage(stored(project('p1', 'A')));
    const user = await mount(storage);
    const name = screen.getByLabelText('Project name');
    await user.clear(name);
    expect(screen.getByText('Please enter a name.')).toBeTruthy();
    await user.type(name, 'Renamed');
    expect(screen.getByRole('link', { name: 'Renamed' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Saved.');
    expect((await loadConfig(storage)).projects[0]?.name).toBe('Renamed');
  });

  it('takes a pasted address over as the website and rejects invalid input at the field', async () => {
    const storage = fakeStorage(stored(project('p1', 'A', { scope: { allSites: false, domains: ['example.org'] } })));
    const user = await mount(storage);
    await addSite(user, 'https://www.example.com/jobs/1');
    expect(screen.getByRole('button', { name: 'Remove website example.com' })).toBeTruthy();
    expect(screen.getByLabelText('Add website')).toHaveProperty('value', '');

    await addSite(user, 'not a site');
    const input = screen.getByLabelText('Add website');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('This is not a valid website. Example: example.com')).toBeTruthy();
    await user.clear(input);
    await addSite(user, 'EXAMPLE.org');
    expect(screen.getByText('This website is already in the list.')).toBeTruthy();
    await user.clear(screen.getByLabelText('Add website'));

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Saved.');
    expect((await loadConfig(storage)).projects[0]?.scope.domains).toEqual(['example.org', 'example.com']);
  });

  it('adds a website with Enter and needs at least one website when sites are specific', async () => {
    const storage = fakeStorage(stored(project('p1', 'A')));
    const user = await mount(storage);
    await user.click(screen.getByRole('radio', { name: 'Specific websites' }));
    expect(screen.getByText('Add at least one website.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText(/Not saved/);
    expect(document.activeElement).toBe(screen.getByLabelText('Add website'));
    await user.type(screen.getByLabelText('Add website'), 'example.com{Enter}');
    expect(screen.getByRole('button', { name: 'Remove website example.com' })).toBeTruthy();
    expect(screen.queryByText('Add at least one website.')).toBeNull();
  });

  it('keeps the page kind list and the custom type together under Advanced', async () => {
    const storage = fakeStorage(stored(project('p1', 'A')));
    const user = await mount(storage);
    const kind = screen.getByLabelText('Only on pages of this kind');
    expect(screen.getByRole('button', { name: 'Advanced' }).getAttribute('aria-expanded')).toBe('false');
    expect(kind.closest('[hidden]')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Advanced' }));
    expect([...(kind as HTMLSelectElement).options].map((o) => o.text)).toEqual([
      'Any kind of page', 'Product', 'Job posting', 'Article', 'Event', 'Recipe', 'Local business',
    ]);
    await user.selectOptions(kind, 'jobPosting');
    await user.type(screen.getByLabelText('Custom page type'), ' Course ');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Saved.');
    expect((await loadConfig(storage)).projects[0]?.scope).toEqual({ allSites: true, domains: [], pageKind: 'jobPosting', pageType: 'Course' });
    await user.selectOptions(kind, '');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Saved.');
    expect((await loadConfig(storage)).projects[0]?.scope).toEqual({ allSites: true, domains: [], pageType: 'Course' });
  });

  it.each([
    ['a page kind', { allSites: true, domains: [], pageKind: 'article' }],
    ['a custom page type', { allSites: true, domains: [], pageType: 'Product' }],
  ])('opens Advanced in the scope when %s is set', async (_name, scope) => {
    await mount(fakeStorage(stored(project('p1', 'A', { scope }))));
    expect(screen.getByRole('button', { name: 'Advanced' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByLabelText('Only on pages of this kind').closest('[hidden]')).toBeNull();
  });

  it('changes scope back to all sites, dropping domains, and clears the page type', async () => {
    const storage = fakeStorage(stored(project('p1', 'A', { scope: { allSites: false, domains: ['example.com'], pageType: 'Product' } })));
    const user = await mount(storage);
    await user.click(screen.getByRole('radio', { name: 'All pages' }));
    expect(screen.queryByLabelText('Add website')).toBeNull();
    await user.clear(screen.getByLabelText('Custom page type'));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Saved.');
    expect((await loadConfig(storage)).projects[0]?.scope).toEqual({ allSites: true, domains: [] });
  });

  it('rejects a duplicate field key, which is only editable under Advanced', async () => {
    const f = (key: string, label: string) => ({ key, label, required: false, sources: {} });
    const storage = fakeStorage(stored(project('p1', 'A', { fields: [f('a', 'First'), f('b', 'Second')] })));
    const user = await mount(storage);
    const second = await openDetails(user, 'Second');
    expect(second.getByLabelText('Field key').closest('[hidden]')).toBeTruthy();
    await user.click(second.getByRole('button', { name: 'Advanced' }));
    await user.clear(second.getByLabelText('Field key'));
    await user.type(second.getByLabelText('Field key'), 'a');
    expect(second.getByText('This key already belongs to another field.')).toBeTruthy();
    await closeDetails(user);
    // The row carries the error with icon and text while the details are closed.
    const row = screen.getAllByRole('row')[2]!;
    expect(row.hasAttribute('data-invalid')).toBe(true);
    expect(within(row).getByText('Check the inputs')).toBeTruthy();
    expect(screen.getAllByRole('row')[1]!.hasAttribute('data-invalid')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText(/Not saved/);
    // Saving opens the details of the first row with an error and focuses its first marked input.
    const reopened = within(await screen.findByRole('dialog', { name: 'Second' }));
    await waitFor(() => expect(document.activeElement).toBe(reopened.getByLabelText('Field key')));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit field Second' }));
    const cfg = await loadConfig(storage);
    expect(cfg.projects[0]?.fields.map((x) => x.key)).toEqual(['a', 'b']);
  });

  it('deletes a project only after confirmation', async () => {
    const storage = fakeStorage(stored(project('p1', 'A'), project('p2', 'B')));
    const user = await mount(storage);
    await headMenu(user, 'A', 'Delete project');
    const dialog = screen.getByRole('dialog', { name: 'Delete project?' });
    expect(dialog.textContent).toContain('"A"');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('link', { name: 'A' })).toBeTruthy();
    await headMenu(user, 'A', 'Delete project');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete project' }));
    expect(screen.queryByRole('link', { name: 'A' })).toBeNull();
    // The view moves on to the next project.
    expect(screen.getByRole('heading', { name: 'B', level: 2 })).toBeTruthy();
    expect(window.location.hash).toBe('#/projects/p2');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Saved.');
    expect((await loadConfig(storage)).projects.map((p) => p.id)).toEqual(['p2']);
  });

  it('offers the same menu on the project title as in the sidebar and reorders projects with it', async () => {
    const storage = fakeStorage(stored(project('p1', 'A'), project('p2', 'B')));
    const user = await mount(storage);
    const titleButtons = () => within(screen.getByRole('main')).queryAllByRole('button', { name: /^(Move|Export|Delete)/ });
    expect(titleButtons()).toEqual([]);
    await user.click(within(screen.getByRole('main')).getByRole('button', { name: 'Options for project A' }));
    const menu = screen.getByRole('menu', { name: 'Options for project A' });
    expect(Array.from(menu.children).map((c) => c.getAttribute('role') === 'separator' ? '-' : c.textContent)).toEqual(['Move up', 'Move down', 'Export', '-', 'Delete project']);
    expect(screen.getByRole('menuitem', { name: 'Move up' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('menuitem', { name: 'Delete project' }).className).toContain('q-menu-item--danger');
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('link', { name: 'B' }));
    await headMenu(user, 'B', 'Move up');
    expect(screen.getByRole('heading', { name: 'B', level: 2 })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Saved.');
    expect((await loadConfig(storage)).projects.map((p) => p.id)).toEqual(['p2', 'p1']);
  });

  it('shows the click mappings per website in the details of their field, with the selector only in the tooltip', async () => {
    const f = (key: string, label: string) => ({ key, label, required: false, sources: {} });
    const storage = fakeStorage(
      stored(project('p1', 'A', {
        fields: [f('title', 'Headline'), f('price', 'Price')],
        siteMappings: { 'example.com': { title: 'h1', price: '.price' }, 'example.org': { title: '.t' } },
      })),
    );
    const user = await mount(storage);
    // The separate mappings section is gone.
    expect(screen.queryByRole('heading', { name: 'Click mappings' })).toBeNull();
    const headline = await openDetails(user, 'Headline');
    const list = headline.getByRole('list');
    expect(within(list).getAllByRole('listitem').map((li) => li.querySelector('.options-mapping-label')?.textContent)).toEqual(['example.com', 'example.org']);
    const tip = within(list).getAllByRole('tooltip', { hidden: true })[0]!;
    expect(tip.textContent).toBe('h1');
    expect(tip.hidden).toBe(true);
    expect(screen.queryAllByText('h1').filter((e) => e.getAttribute('role') !== 'tooltip')).toEqual([]);
    await user.click(headline.getByRole('button', { name: 'Show saved selection for example.com' }));
    expect(tip.hidden).toBe(false);

    await user.click(headline.getByRole('button', { name: 'Remove mapping for example.org' }));
    expect(headline.queryByText('example.org')).toBeNull();
    await user.click(headline.getByRole('button', { name: 'Advanced' }));
    const key = headline.getByLabelText('Field key');
    await user.clear(key);
    await user.type(key, 'headline');
    expect(headline.getByText('example.com')).toBeTruthy();
    await closeDetails(user);
    const price = await openDetails(user, 'Price');
    await user.click(price.getByRole('button', { name: 'Remove mapping for example.com' }));
    expect(price.getByText('No click mapping yet.')).toBeTruthy();
    await closeDetails(user);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Saved.');
    expect((await loadConfig(storage)).projects[0]?.siteMappings).toEqual({ 'example.com': { headline: 'h1' } });
  });

  it('drops site mappings of a deleted field', async () => {
    const f = { key: 'title', label: 'Title', required: false, sources: {} };
    const storage = fakeStorage(stored(project('p1', 'A', { fields: [f], siteMappings: { 'example.com': { title: 'h1' } } })));
    const user = await mount(storage);
    const details = await openDetails(user, 'Title');
    const remove = details.getByRole('button', { name: 'Delete field: Title' });
    expect(remove.textContent).toBe('Delete field');
    expect(remove.className).toContain('q-button--danger');
    await user.click(remove);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('No fields yet.')).toBeTruthy();
    // Without a row left, the focus goes to the input for a new field.
    expect(document.activeElement).toBe(screen.getByLabelText('Label of the new field'));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Saved.');
    expect((await loadConfig(storage)).projects[0]?.siteMappings).toEqual({});
  });

  it('shows a mapping without field as a warning line that can be removed, so it does not block saving', async () => {
    const f = (key: string, label: string) => ({ key, label, required: false, sources: {} });
    const storage = fakeStorage(stored(project('p1', 'A', { fields: [f('a', 'First'), f('b', 'Second')], siteMappings: { 'example.com': { b: '.b' } } })));
    const user = await mount(storage);
    const second = await openDetails(user, 'Second');
    await user.click(second.getByRole('button', { name: 'Advanced' }));
    const key = second.getByLabelText('Field key');
    // A rename onto a taken key leaves the mapping under the old key, then it belongs to no field.
    await user.type(key, 'a', { initialSelectionStart: 0, initialSelectionEnd: 1 });
    expect(second.getByText('This key already belongs to another field.')).toBeTruthy();
    await user.type(key, 'c', { initialSelectionStart: 0, initialSelectionEnd: 1 });
    await closeDetails(user);
    expect(screen.getByText('Selection on example.com belongs to no field (b).')).toBeTruthy();
    expect(screen.getAllByRole('row').some((r) => r.hasAttribute('data-invalid'))).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText(/Not saved/);
    // The error has no input of its own; the focus goes to the action that resolves it.
    const remove = screen.getByRole('button', { name: 'Remove mapping b for example.com' });
    await waitFor(() => expect(document.activeElement).toBe(remove));
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(remove);
    expect(screen.queryByText(/belongs to no field/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Saved.');
    const saved = (await loadConfig(storage)).projects[0]!;
    expect(saved.fields.map((x) => x.key)).toEqual(['a', 'c']);
    expect(saved.siteMappings).toEqual({});
  });

  describe('fields', () => {
    const f = (key: string, label: string, sources: Record<string, unknown> = {}) => ({ key, label, required: false, sources });

    it('detects a value automatically, derives the key from the label and keeps it when the label changes', async () => {
      const storage = fakeStorage(stored(project('p1', 'A')));
      const user = await mount(storage);
      await addField(user, 'Größe der Straße');
      const field = within(screen.getByRole('dialog', { name: 'Größe der Straße' }));
      await user.selectOptions(field.getByLabelText('Where does the value come from?'), 'detect');
      await user.selectOptions(field.getByLabelText('What should be detected?'), 'title');
      await user.click(field.getByLabelText('Required'));
      const label = field.getByLabelText('Label');
      await user.clear(label);
      await user.type(label, 'Headline');
      await closeDetails(user);
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await screen.findByText('Saved.');
      expect((await loadConfig(storage)).projects[0]?.fields).toEqual([
        { key: 'groesse_der_strasse', label: 'Headline', required: true, format: 'text', sources: { detect: 'title' } },
      ]);
    });

    it('makes keys unique per project and falls back to "field" for labels without ASCII letters', async () => {
      const user = await mount(fakeStorage(stored(project('p1', 'A'))));
      for (const label of ['Price', 'Price', 'Über uns', '価格']) {
        await addField(user, label);
        await closeDetails(user);
      }
      const keys: string[] = [];
      for (const [n, i] of [['Price', 0], ['Price', 1], ['Über uns', 0], ['価格', 0]] as const) {
        const details = await openDetails(user, n, i);
        keys.push((details.getByLabelText('Field key', { selector: 'input' }) as HTMLInputElement).value);
        await closeDetails(user);
      }
      expect(keys).toEqual(['price', 'price_2', 'ueber_uns', 'field']);
    });

    it('takes the click way without any source and removes the detect value and the manual input', async () => {
      const storage = fakeStorage(stored(project('p1', 'A', { fields: [f('title', 'Headline', { detect: 'title', schemaOrgPath: 'Article.headline' })] })));
      const user = await mount(storage);
      const field = await openDetails(user, 'Headline');
      expect((field.getByLabelText('Where does the value come from?') as HTMLSelectElement).value).toBe('detect');
      await user.selectOptions(field.getByLabelText('Where does the value come from?'), 'click');
      expect(field.queryByLabelText('What should be detected?')).toBeNull();
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await screen.findByText('Saved.');
      expect((await loadConfig(storage)).projects[0]?.fields[0]?.sources).toEqual({ schemaOrgPath: 'Article.headline' });
    });

    it('offers three formats for the click and detect ways, none for typed-in values, and saves the choice', async () => {
      const storage = fakeStorage(stored(project('p1', 'A')));
      const user = await mount(storage);
      await addField(user, 'Contact');
      const field = within(screen.getByRole('dialog', { name: 'Contact' }));
      expect((field.getByLabelText('Format') as HTMLSelectElement).value).toBe('text');
      expect(Array.from((field.getByLabelText('Format') as HTMLSelectElement).options).map((o) => o.value)).toEqual(['text', 'markdown', 'html']);
      await user.selectOptions(field.getByLabelText('Where does the value come from?'), 'detect');
      expect(field.getByLabelText('Format')).toBeTruthy();
      await user.selectOptions(field.getByLabelText('Where does the value come from?'), 'click');
      await user.selectOptions(field.getByLabelText('Format'), 'markdown');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await screen.findByText('Saved.');
      expect((await loadConfig(storage)).projects[0]?.fields[0]?.format).toBe('markdown');
      await user.selectOptions(field.getByLabelText('Where does the value come from?'), 'manual');
      expect(field.queryByLabelText('Format')).toBeNull();
    });

    it('saves a choice list with its chip values, rejects duplicates and needs at least one value', async () => {
      const storage = fakeStorage(stored(project('p1', 'A')));
      const user = await mount(storage);
      await addField(user, 'Status');
      const field = within(screen.getByRole('dialog', { name: 'Status' }));
      await user.selectOptions(field.getByLabelText('Where does the value come from?'), 'manual');
      await user.selectOptions(field.getByLabelText('Kind of input'), 'choice');
      expect(field.getByText('Add at least one value.')).toBeTruthy();
      await user.type(field.getByLabelText('Add value'), 'Draft{Enter}');
      await user.type(field.getByLabelText('Add value'), 'Final');
      await user.click(field.getByRole('button', { name: 'Add' }));
      await user.type(field.getByLabelText('Add value'), 'Draft{Enter}');
      expect(field.getByText('This value is already in the list.')).toBeTruthy();
      await user.clear(field.getByLabelText('Add value'));
      await user.type(field.getByLabelText('Add value'), 'Old{Enter}');
      await user.click(field.getByRole('button', { name: 'Remove value Old' }));
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await screen.findByText('Saved.');
      expect((await loadConfig(storage)).projects[0]?.fields[0]?.sources).toEqual({ manual: { type: 'choice', values: ['Draft', 'Final'] } });
    });

    it('keeps the technical sources under Advanced and saves them', async () => {
      const storage = fakeStorage(stored(project('p1', 'A')));
      const user = await mount(storage);
      await addField(user, 'Summary');
      const field = within(screen.getByRole('dialog', { name: 'Summary' }));
      await user.click(field.getByRole('button', { name: 'Advanced' }));
      await user.selectOptions(field.getByLabelText('Meta tag: attribute'), 'property');
      await user.type(field.getByLabelText('Meta tag: name'), 'og:description');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await screen.findByText('Saved.');
      expect((await loadConfig(storage)).projects[0]?.fields[0]?.sources).toEqual({ metaTag: { attribute: 'property', name: 'og:description' } });
    });

    const rowNames = () => screen.getAllByRole('row').slice(1).map((r) => r.querySelector('.options-field-name')?.firstChild?.textContent);

    it('shows the fields as a table with source, format, required and the number of mapped websites', async () => {
      const fields = [
        { ...f('title', 'Headline', { detect: 'title' }), required: true },
        { ...f('price', 'Price'), format: 'text' },
        f('status', 'Status', { manual: { type: 'text' } }),
      ];
      await mount(fakeStorage(stored(project('p1', 'A', { fields, siteMappings: { 'example.com': { price: '.p' }, 'example.org': { price: '#p', title: 'h1' } } }))));
      const table = screen.getByRole('table', { name: 'Fields' });
      expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Order', 'Label', 'Source', 'Format', 'Required', 'Websites', 'Actions']);
      const cells = within(table).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell').slice(1, 6));
      const text = cells.map((c) => [c[0]!.textContent, within(c[1]!).getByRole('img').getAttribute('aria-label'), c[2]!.textContent, c[3]!.textContent, c[4]!.textContent]);
      expect(text).toEqual([
        ['Headline', 'Detected automatically: Title', 'Text', 'Yes', '1'],
        ['Price', 'Assigned by click', 'Text', 'No', '2'],
        ['Status', 'Enter it yourself', 'Text', 'No', '0'],
      ]);
      // Every row has its grip and its open action in the tab order.
      expect(screen.getByRole('button', { name: 'Move field Price' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Edit field Price' })).toBeTruthy();
    });

    it('reorders fields with the arrow keys at the grip, announces the position and keeps the focus on the moved field', async () => {
      const storage = fakeStorage(stored(project('p1', 'A', { fields: [f('a', 'First'), f('b', 'Second'), f('c', 'Third')] })));
      const user = await mount(storage);
      const grip = screen.getByRole('button', { name: 'Move field Third' });
      expect(document.getElementById(grip.getAttribute('aria-describedby')!)?.textContent).toMatch(/arrow keys/);
      act(() => grip.focus());
      await user.keyboard('{ArrowUp}');
      expect(rowNames()).toEqual(['First', 'Third', 'Second']);
      expect(screen.getByText('Third: position 2 of 3')).toBeTruthy();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move field Third' }));
      await user.keyboard('{ArrowUp}{ArrowUp}');
      expect(rowNames()).toEqual(['Third', 'First', 'Second']);
      expect(screen.getByText('Third: position 1 of 3')).toBeTruthy();
      act(() => screen.getByRole('button', { name: 'Move field First' }).focus());
      await user.keyboard('{ArrowDown}');
      expect(rowNames()).toEqual(['Third', 'Second', 'First']);
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move field First' }));
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await screen.findByText('Saved.');
      expect((await loadConfig(storage)).projects[0]?.fields.map((x) => x.key)).toEqual(['c', 'b', 'a']);
    });

    it('reorders fields by dragging the grip onto another row', async () => {
      const storage = fakeStorage(stored(project('p1', 'A', { fields: [f('a', 'First'), f('b', 'Second'), f('c', 'Third')] })));
      await mount(storage);
      const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), setDragImage: vi.fn() };
      const rows = screen.getAllByRole('row');
      fireEvent.dragStart(screen.getByRole('button', { name: 'Move field First' }), { dataTransfer });
      fireEvent.dragOver(rows[3]!, { dataTransfer });
      expect(rows[3]!.className).toContain('is-drop-after');
      fireEvent.drop(rows[3]!, { dataTransfer });
      expect(rowNames()).toEqual(['Second', 'Third', 'First']);
      expect(screen.getByText('First: position 3 of 3')).toBeTruthy();
      expect(dataTransfer.setDragImage).toHaveBeenCalledWith(rows[1], 0, 0);
    });

    it('opens the details from the row, returns the focus to the row and shows the way explanation on focus', async () => {
      const storage = fakeStorage(stored(project('p1', 'A', { fields: [f('a', 'First'), f('b', 'Second')] })));
      const user = await mount(storage);
      const open = screen.getByRole('button', { name: 'Edit field First' });
      await user.click(open);
      const first = within(screen.getByRole('dialog', { name: 'First' }));
      // The way help is the first one; a click-way field also has a format help after it.
      const help = first.getAllByRole('button', { name: 'More information' })[0]!;
      act(() => help.focus());
      expect(document.getElementById(help.getAttribute('aria-describedby')!)?.hidden).toBe(false);
      expect(document.getElementById(help.getAttribute('aria-describedby')!)?.textContent).toMatch(/click the value on the page/);
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(open);
      // A click anywhere on the row opens the details as well.
      await user.click(screen.getByText('Second'));
      expect(screen.getByRole('dialog', { name: 'Second' })).toBeTruthy();
      await user.click(screen.getByRole('button', { name: 'Delete field: Second' }));
      expect(document.activeElement).toBe(open);
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await screen.findByText('Saved.');
      expect((await loadConfig(storage)).projects[0]?.fields.map((x) => x.key)).toEqual(['a']);
    });

    it('shows the label error at the field and the document title in the active language', async () => {
      const user = await mount(fakeStorage(stored(project('p1', 'A', { fields: [f('a', 'First')] }))));
      expect(document.title).toBe('Qatlas Clipper');
      await openDetails(user, 'First');
      await user.clear(screen.getByLabelText('Label'));
      expect(screen.getByLabelText('Label').getAttribute('aria-invalid')).toBe('true');
      expect(screen.getByText('Please enter a label.')).toBeTruthy();
    });
  });

  it('shows an error for an invalid stored config and keeps it untouched', async () => {
    const bad = { schemaVersion: 1, projects: [{ id: 'p1' }] };
    const storage = fakeStorage({ [CONFIG_KEY]: bad });
    render(<OptionsApp storage={storage} />);
    await screen.findByText(/could not be loaded/);
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    expect(storage.data[CONFIG_KEY]).toEqual(bad);
  });

  describe('targets', () => {
    const target = (id: string, url: string, extra: Record<string, unknown> = {}) => ({ id, name: id, url, headers: [], purpose: '', ...extra });

    /** Adds a target; its details open and stay open. */
    async function addTarget(user: ReturnType<typeof userEvent.setup>, url: string) {
      await user.click(screen.getByRole('button', { name: 'Add target' }));
      const url_ = within(screen.getByRole('dialog')).getByLabelText('Webhook address');
      await user.clear(url_);
      await user.type(url_, url);
    }

    const openTarget = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
      await user.click(screen.getByRole('button', { name: `Edit target ${name}` }));
      return within(screen.getByRole('dialog', { name }));
    };

    it('requests the host permission on save and shows the status with text', async () => {
      const storage = fakeStorage(stored(project('p1', 'A')));
      const permissions = fakePermissions();
      const user = await mount(storage, permissions);
      await addTarget(user, 'https://example.com/hook');
      expect(screen.getByTestId('permission-0').textContent).toContain('Access missing');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await screen.findByText('Saved.');
      await waitFor(() => expect(screen.getByTestId('permission-0').textContent).toContain('Access allowed'));
      expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull();
      expect(permissions.request).toHaveBeenCalledWith(['https://example.com/*']);
    });

    it('maps the access key to the Authorization header name in the config and Bearer <key> in the header values only', async () => {
      const storage = fakeStorage(stored(project('p1', 'A')));
      const user = await mount(storage);
      await addTarget(user, 'https://example.com/hook');
      const key = screen.getByLabelText('Access key (optional)');
      expect(key.getAttribute('type')).toBe('password');
      await user.type(key, 'secret-key');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await screen.findByText('Saved.');
      const cfg = await loadConfig(storage);
      const t = cfg.projects[0]!.targets[0]!;
      expect(t.headers).toEqual(['Authorization']);
      expect(JSON.stringify(storage.data[CONFIG_KEY])).not.toContain('secret-key');
      expect(storage.data[HEADER_VALUES_KEY]).toEqual({ [t.id]: { Authorization: 'Bearer secret-key' } });
      expect(await exportConfig(storage)).not.toContain('secret-key');
    });

    it('toggles the visibility of the access key', async () => {
      const user = await mount(fakeStorage(stored(project('p1', 'A', { targets: [target('t1', 'https://example.com/a')] }))));
      const details = await openTarget(user, 't1');
      await user.click(details.getByRole('button', { name: 'Advanced' }));
      const key = details.getByLabelText('Access key (optional)');
      const toggle = details.getByRole('checkbox', { name: 'Show access key' });
      await user.click(toggle);
      expect(key.getAttribute('type')).toBe('text');
      await user.click(toggle);
      expect(key.getAttribute('type')).toBe('password');
    });

    it('recognizes a stored Bearer value as the access key, hides it from the advanced list, and clears both on removal', async () => {
      const storage = fakeStorage({
        ...stored(project('p1', 'A', { targets: [target('t1', 'https://example.com/a', { headers: ['Authorization', 'X-Extra'] })] })),
        [HEADER_VALUES_KEY]: { t1: { Authorization: 'Bearer abc', 'X-Extra': 'v' } },
      });
      const user = await mount(storage);
      const details = await openTarget(user, 't1');
      const key = details.getByLabelText('Access key (optional)') as HTMLInputElement;
      expect(key.value).toBe('abc');
      // Only the extra header is listed; the access key is not duplicated.
      expect(details.getAllByLabelText('Header name')).toHaveLength(1);
      expect((details.getByLabelText('Header name') as HTMLInputElement).value).toBe('X-Extra');
      await user.clear(key);
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await screen.findByText('Saved.');
      expect((await loadConfig(storage)).projects[0]!.targets[0]!.headers).toEqual(['X-Extra']);
      expect(storage.data[HEADER_VALUES_KEY]).toEqual({ t1: { 'X-Extra': 'v' } });
    });

    it('keeps an Authorization header with another scheme as a custom header and locks the key field', async () => {
      const storage = fakeStorage({
        ...stored(project('p1', 'A', { targets: [target('t1', 'https://example.com/a', { headers: ['Authorization'] })] })),
        [HEADER_VALUES_KEY]: { t1: { Authorization: 'Basic xyz' } },
      });
      const user = await mount(storage);
      const details = await openTarget(user, 't1');
      expect((details.getByLabelText('Access key (optional)') as HTMLInputElement).disabled).toBe(true);
      expect((details.getByLabelText('Header name') as HTMLInputElement).value).toBe('Authorization');
    });

    it('edits custom headers under Advanced and removes a target with its values', async () => {
      const storage = fakeStorage(stored(project('p1', 'A')));
      const user = await mount(storage);
      await addTarget(user, 'https://example.com/hook');
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Advanced' }));
      await user.click(screen.getByRole('button', { name: 'Add header' }));
      await user.type(screen.getByLabelText('Header name'), 'X-Token');
      await user.type(screen.getByLabelText('Header value'), 'abc');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await screen.findByText('Saved.');
      const id = (await loadConfig(storage)).projects[0]!.targets[0]!.id;
      expect(storage.data[HEADER_VALUES_KEY]).toEqual({ [id]: { 'X-Token': 'abc' } });
      await user.click(screen.getByRole('button', { name: 'Remove target' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add target' }));
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await screen.findByText('Saved.');
      expect((await loadConfig(storage)).projects[0]!.targets).toEqual([]);
      expect(storage.data[HEADER_VALUES_KEY]).toEqual({});
    });

    it('marks a denied permission with text and icon and allows asking again; saving does not depend on it', async () => {
      const storage = fakeStorage(stored(project('p1', 'A')));
      const permissions = fakePermissions(false);
      const user = await mount(storage, permissions);
      await addTarget(user, 'https://example.com/hook');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await screen.findByText('Saved.');
      const badge = await screen.findByTestId('permission-0');
      await waitFor(() => expect(badge.textContent).toContain('Access missing'));
      expect(badge.querySelector('svg')).not.toBeNull();
      expect((await loadConfig(storage)).projects[0]?.targets).toHaveLength(1);
      permissions.request.mockImplementationOnce(async (o: string[]) => {
        o.forEach((x) => permissions.granted.add(x));
        return true;
      });
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Allow' }));
      await waitFor(() => expect(badge.textContent).toContain('Access allowed'));
      expect(permissions.request).toHaveBeenCalledTimes(2);
      expect(permissions.request).toHaveBeenLastCalledWith(['https://example.com/*']);
    });

    it('revokes the permission of a deleted target only if no other target shares the origin', async () => {
      const storage = fakeStorage(
        stored(
          project('p1', 'A', { targets: [target('t1', 'https://example.com/a'), target('t2', 'https://other.example.org/b')] }),
          project('p2', 'B', { targets: [target('t3', 'https://example.com/c')] }),
        ),
      );
      const permissions = fakePermissions();
      const user = await mount(storage, permissions);
      await openTarget(user, 't1');
      await user.click(screen.getByRole('button', { name: 'Remove target' }));
      await openTarget(user, 't2');
      await user.click(screen.getByRole('button', { name: 'Remove target' }));
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await screen.findByText('Saved.');
      expect(permissions.remove).toHaveBeenCalledTimes(1);
      expect(permissions.remove).toHaveBeenCalledWith(['https://other.example.org/*']);
    });

    it('accepts https and http://localhost, rejects other http hosts without echoing the value', async () => {
      const storage = fakeStorage(stored(project('p1', 'A')));
      const user = await mount(storage);
      await addTarget(user, 'http://example.com/hook');
      expect(screen.getAllByText(/only allowed for localhost/).length).toBeGreaterThan(0);
      expect(screen.getByLabelText('Webhook address').getAttribute('aria-invalid')).toBe('true');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await screen.findByText(/Not saved/);
      expect((storage.data[CONFIG_KEY] as { projects: { targets: unknown[] }[] }).projects[0]?.targets).toEqual([]);
      const url = screen.getByLabelText('Webhook address');
      await user.clear(url);
      await user.type(url, 'http://localhost:8080/hook');
      expect(screen.queryByText(/only allowed for localhost/)).toBeNull();
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await screen.findByText('Saved.');
      expect((await loadConfig(storage)).projects[0]?.targets[0]?.url).toBe('http://localhost:8080/hook');
    });

    it('lists the targets with name, shortened address and access status, and keeps the key out of the list', async () => {
      const long = 'https://hooks.example.com/services/abcdefghijklmnopqrstuvwxyz/0123456789/trailing?token=shh#frag';
      const storage = fakeStorage({
        ...stored(project('p1', 'A', { targets: [target('t1', 'https://example.com/hook', { headers: ['Authorization'] }), target('t2', long)] })),
        [HEADER_VALUES_KEY]: { t1: { Authorization: 'Bearer secret-key' } },
      });
      const permissions = fakePermissions();
      permissions.granted.add('https://example.com/*');
      await mount(storage, permissions);
      const table = screen.getByRole('table', { name: 'Targets' });
      expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Order', 'Name', 'Webhook address', 'Access', 'Actions']);
      const rows = within(table).getAllByRole('row').slice(1);
      await waitFor(() => expect(rows[0]!.textContent).toContain('Access allowed'));
      expect(rows[0]!.textContent).toContain('t1');
      expect(rows[0]!.textContent).toContain('example.com/hook');
      expect(rows[1]!.textContent).toContain('Access missing');
      const shown = within(rows[1]!).getByText(/^hooks\.example\.com\/services/);
      expect(shown.textContent!.length).toBeLessThan(long.length);
      expect(shown.textContent).toMatch(/…$/);
      expect(shown.textContent).not.toContain('token');
      // The full address is the tooltip; the key is nowhere in the list.
      expect(document.getElementById(shown.getAttribute('aria-describedby')!)?.textContent).toBe(long);
      expect(table.textContent).not.toContain('secret-key');
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('opens the details from the row and the button, returns the focus and moves a target with the arrows', async () => {
      const storage = fakeStorage(stored(project('p1', 'A', { targets: [target('t1', 'https://example.com/a'), target('t2', 'https://example.com/b')] })));
      const user = await mount(storage);
      const open = screen.getByRole('button', { name: 'Edit target t1' });
      await user.click(open);
      expect(within(screen.getByRole('dialog', { name: 't1' })).getByLabelText('Webhook address')).toHaveProperty('value', 'https://example.com/a');
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(open);
      await user.click(screen.getByText('t2'));
      expect(screen.getByRole('dialog', { name: 't2' })).toBeTruthy();
      await user.keyboard('{Escape}');
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit target t2' }));
      const names = () => screen.getAllByRole('row').slice(1).map((r) => r.querySelector('.options-field-name')?.firstChild?.textContent);
      expect(screen.queryByRole('button', { name: /Move up target/ })).toBeNull();
      act(() => screen.getByRole('button', { name: 'Move target t2' }).focus());
      await user.keyboard('{ArrowUp}');
      expect(names()).toEqual(['t2', 't1']);
      expect(screen.getByText('t2: position 1 of 2')).toBeTruthy();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move target t2' }));
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await screen.findByText('Saved.');
      expect((await loadConfig(storage)).projects[0]!.targets.map((x) => x.id)).toEqual(['t2', 't1']);
    });

    it('reorders targets by dragging the grip onto another row', async () => {
      const storage = fakeStorage(stored(project('p1', 'A', { targets: [target('t1', 'https://example.com/a'), target('t2', 'https://example.com/b'), target('t3', 'https://example.com/c')] })));
      await mount(storage);
      const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), setDragImage: vi.fn() };
      const rows = screen.getAllByRole('row');
      fireEvent.dragStart(screen.getByRole('button', { name: 'Move target t1' }), { dataTransfer });
      fireEvent.dragOver(rows[3]!, { dataTransfer });
      expect(rows[3]!.className).toContain('is-drop-after');
      fireEvent.drop(rows[3]!, { dataTransfer });
      expect(screen.getAllByRole('row').slice(1).map((r) => r.querySelector('.options-field-name')?.firstChild?.textContent)).toEqual(['t2', 't3', 't1']);
      expect(screen.getByText('t1: position 3 of 3')).toBeTruthy();
      await userEvent.setup().click(screen.getByRole('button', { name: 'Save changes' }));
      await screen.findByText('Saved.');
      expect((await loadConfig(storage)).projects[0]!.targets.map((x) => x.id)).toEqual(['t2', 't3', 't1']);
    });

    it('keeps Advanced closed without a key or header and opens it for a key or a header', async () => {
      const storage = fakeStorage({
        ...stored(
          project('p1', 'A', {
            targets: [
              target('plain', 'https://example.com/a'),
              target('keyed', 'https://example.com/b', { headers: ['Authorization'] }),
              target('custom', 'https://example.com/c', { headers: ['X-Extra'] }),
            ],
          }),
        ),
        [HEADER_VALUES_KEY]: { keyed: { Authorization: 'Bearer abc' } },
      });
      const user = await mount(storage);
      const expanded: Record<string, string | null> = {};
      for (const name of ['plain', 'keyed', 'custom']) {
        const details = await openTarget(user, name);
        expanded[name] = details.getByRole('button', { name: 'Advanced' }).getAttribute('aria-expanded');
        await user.keyboard('{Escape}');
      }
      expect(expanded).toEqual({ plain: 'false', keyed: 'true', custom: 'true' });
    });

    it('asks for the access to the origin synchronously in the click inside the details', async () => {
      const permissions = fakePermissions(false);
      const user = await mount(fakeStorage(stored(project('p1', 'A', { targets: [target('t1', 'https://example.com/a')] }))), permissions);
      const details = await openTarget(user, 't1');
      fireEvent.click(details.getByRole('button', { name: 'Allow' }));
      // No await between the click and the check: the request has to start inside the user gesture.
      expect(permissions.request).toHaveBeenCalledWith(['https://example.com/*']);
    });

    it('marks both destructive buttons with the danger variant', async () => {
      const user = await mount(fakeStorage(stored(project('p1', 'A', { targets: [target('t1', 'https://example.com/a')] }))));
      await user.click(within(screen.getByRole('main')).getByRole('button', { name: 'Options for project A' }));
      expect(screen.getByRole('menuitem', { name: 'Delete project' }).className).toContain('q-menu-item--danger');
      await user.keyboard('{Escape}');
      const details = await openTarget(user, 't1');
      expect(details.getByRole('button', { name: 'Remove target' }).className).toContain('q-button--danger');
    });

    it('marks a row with a check error and opens its details on the first error when saving', async () => {
      const storage = fakeStorage(stored(project('p1', 'A', { targets: [target('t1', 'https://example.com/a'), target('t2', 'https://example.com/b')] })));
      const user = await mount(storage);
      const details = await openTarget(user, 't2');
      const url = details.getByLabelText('Webhook address');
      await user.clear(url);
      await user.type(url, 'http://example.com/hook');
      await user.keyboard('{Escape}');
      const rows = screen.getAllByRole('row').slice(1);
      expect(rows[0]!.hasAttribute('data-invalid')).toBe(false);
      expect(rows[1]!.hasAttribute('data-invalid')).toBe(true);
      expect(within(rows[1]!).getByText('Check the inputs')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Edit target t2' }).hasAttribute('data-error-open')).toBe(true);
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await screen.findByText(/Not saved/);
      const dialog = await screen.findByRole('dialog', { name: 't2' });
      await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByLabelText('Webhook address')));
    });
  });
});

describe('import and export', () => {
  const target = { id: 't1', name: 'Hook', url: 'https://example.com/hook', headers: ['Authorization'], purpose: '' };
  const imported = JSON.stringify({ schemaVersion: 1, projects: [project('n1', 'Imported 1'), project('n2', 'Imported 2')] });
  const withHeader = () =>
    fakeStorage({ ...stored(project('p1', 'Old', { targets: [target] })), [HEADER_VALUES_KEY]: { t1: { Authorization: 'secret-token' } } });
  const DIALOG = 'Replace configuration?';

  afterEach(() => vi.unstubAllGlobals());

  const exportDone = 'The saved configuration was exported.';

  it('exports the saved configuration without header values and says so', async () => {
    const storage = withHeader();
    let written = '';
    const writable = { write: vi.fn(async (t: string) => void (written = t)), close: vi.fn(async () => {}) };
    let options: unknown;
    vi.stubGlobal('showSaveFilePicker', async (o: unknown) => ((options = o), { createWritable: async () => writable }));
    const user = await mount(storage, fakePermissions(), IMPORT_EXPORT);
    expect(screen.getByText(/Access keys are not included/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await screen.findByText(exportDone);
    expect(options).toMatchObject({ suggestedName: 'qatlas-clipper-config.json' });
    expect(written).toContain('Authorization');
    expect(written).not.toContain('secret-token');
    expect(writable.close).toHaveBeenCalledOnce();
  });

  it('reports the export only after the file is closed', async () => {
    let finish!: () => void;
    const writable = { write: vi.fn(async () => {}), close: vi.fn(() => new Promise<void>((r) => (finish = r))) };
    vi.stubGlobal('showSaveFilePicker', async () => ({ createWritable: async () => writable }));
    const user = await mount(withHeader(), fakePermissions(), IMPORT_EXPORT);
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(writable.close).toHaveBeenCalled());
    expect(screen.queryByText(exportDone)).toBeNull();
    finish();
    await screen.findByText(exportDone);
  });

  it('stays silent when the save dialog is cancelled', async () => {
    const picker = vi.fn(async () => {
      throw new DOMException('cancelled', 'AbortError');
    });
    vi.stubGlobal('showSaveFilePicker', picker);
    const user = await mount(withHeader(), fakePermissions(), IMPORT_EXPORT);
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(picker).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByText(exportDone)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows other save errors as an error message that stays', async () => {
    vi.stubGlobal('showSaveFilePicker', async () => ({
      createWritable: async () => ({ write: async () => { throw new Error('disk full'); }, close: async () => {} }),
    }));
    const user = await mount(withHeader(), fakePermissions(), IMPORT_EXPORT);
    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Export failed: disk full');
    expect(screen.queryByText(exportDone)).toBeNull();
  });

  it('falls back to a download without a message when there is no save dialog', async () => {
    const storage = withHeader();
    let blob: Blob | undefined;
    URL.createObjectURL = vi.fn((b: Blob) => ((blob = b), 'blob:x'));
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const user = await mount(storage, fakePermissions(), IMPORT_EXPORT);
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    const text = await blob!.text();
    expect(text).toContain('Authorization');
    expect(text).not.toContain('secret-token');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:x');
    expect(screen.queryByText(exportDone)).toBeNull();
    click.mockRestore();
  });

  it.each([['en'], ['de']] as const)('keeps header and Bearer out of the view in %s', async (language) => {
    const storage = fakeStorage({ ...stored(project('p1', 'Old')), [SETTINGS_KEY]: { language, appearance: 'light' } });
    render(
      <SettingsProvider storage={storage} subscribe={() => () => {}} media={{ matches: false, addEventListener() {}, removeEventListener() {} }} browserLanguage="en-US">
        <OptionsApp storage={storage} permissions={fakePermissions()} />
      </SettingsProvider>,
    );
    const c = language === 'en' ? en : de;
    await userEvent.setup().click(await screen.findByRole('link', { name: c['options.nav.importExport'] }));
    const section = (await screen.findByRole('heading', { name: c['options.nav.importExport'], level: 2 })).closest('section') as HTMLElement;
    expect(within(section).getAllByRole('heading', { level: 3 })).toHaveLength(2);
    expect(visibleText(section, () => false)).not.toMatch(/header|bearer/i);
    expect(c['options.io.export.note']).toMatch(language === 'en' ? /Access keys/ : /Zugangsschlüssel/);
  });

  it('shows a preview with the project count and replaces only after confirmation', async () => {
    const storage = withHeader();
    const before = structuredClone(storage.data);
    const user = await mount(storage, fakePermissions(), IMPORT_EXPORT);
    const file = new File([imported], 'c.json', { type: 'application/json' });
    await user.upload(screen.getByLabelText('From file'), file);
    const dialog = await screen.findByRole('dialog', { name: DIALOG });
    expect(dialog.textContent).toContain('2 projects');
    expect(dialog.textContent).toContain('whole current configuration is replaced');
    expect(storage.data).toEqual(before);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: DIALOG })).toBeNull();
    expect(storage.data).toEqual(before);

    await user.upload(screen.getByLabelText('From file'), file);
    await user.click(await screen.findByRole('button', { name: 'Replace' }));
    expect(await screen.findByRole('link', { name: 'Imported 1' })).toBeTruthy();
    // The message survives the reload that remounts the page content.
    expect(screen.getByText(/Imported: 2 projects/)).toBeTruthy();
    expect((await loadConfig(storage)).projects.map((p) => p.name)).toEqual(['Imported 1', 'Imported 2']);
  });

  it('shows an error at the file field for invalid files without storing and without echoing content', async () => {
    const storage = withHeader();
    const before = structuredClone(storage.data);
    const user = await mount(storage, fakePermissions(), IMPORT_EXPORT);
    await user.upload(screen.getByLabelText('From file'), new File(['{"secret-marker":'], 'c.json'));
    const alert = await screen.findByText(/Import failed/);
    expect(alert.textContent).not.toContain('secret-marker');
    expect(storage.data).toEqual(before);
    expect(screen.queryByRole('dialog', { name: DIALOG })).toBeNull();
    expect(screen.getByRole('button', { name: 'Export' })).toHaveProperty('disabled', false);
    expect(screen.getByLabelText('From file')).toHaveProperty('disabled', false);
  });

  it('mentions discarded unsaved changes in the confirmation', async () => {
    const user = await mount(withHeader());
    await titleMenu(user, 'Add project');
    await user.click(screen.getByRole('link', { name: 'Import and export' }));
    expect(screen.getByText(/Unsaved changes are not exported/)).toBeTruthy();
    await user.upload(screen.getByLabelText('From file'), new File([imported], 'c.json'));
    expect((await screen.findByRole('dialog', { name: DIALOG })).textContent).toContain('Unsaved changes are discarded');
  });

  it('requests the origin permission, then fetches, previews and replaces only after confirmation', async () => {
    const storage = withHeader();
    const permissions = fakePermissions();
    const fetchMock = vi.fn(async () => new Response(imported));
    vi.stubGlobal('fetch', fetchMock);
    const user = await mount(storage, permissions, IMPORT_EXPORT);
    await user.type(screen.getByLabelText('From address'), 'https://example.org/c.json');
    await user.click(screen.getByRole('button', { name: 'Load' }));
    const dialog = await screen.findByRole('dialog', { name: DIALOG });
    expect(permissions.request).toHaveBeenCalledWith(['https://example.org/*']);
    expect(fetchMock).toHaveBeenCalledWith('https://example.org/c.json', { credentials: 'omit', redirect: 'error' });
    expect(dialog.textContent).toContain('2 projects');
    expect((await loadConfig(storage)).projects.map((p) => p.name)).toEqual(['Old']);
    await user.click(screen.getByRole('button', { name: 'Replace' }));
    await screen.findByRole('link', { name: 'Imported 2' });
    expect((await loadConfig(storage)).projects).toHaveLength(2);
  });

  it('does not fetch when the permission is denied and keeps the address', async () => {
    const storage = withHeader();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const user = await mount(storage, fakePermissions(false), IMPORT_EXPORT);
    await user.type(screen.getByLabelText('From address'), 'https://example.org/c.json');
    await user.click(screen.getByRole('button', { name: 'Load' }));
    await screen.findByText(/permission for the address was not granted/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: DIALOG })).toBeNull();
    expect(screen.getByLabelText('From address')).toHaveProperty('value', 'https://example.org/c.json');
  });

  it('rejects plain http URLs except localhost without asking for permission', async () => {
    const permissions = fakePermissions();
    const user = await mount(withHeader(), permissions, IMPORT_EXPORT);
    await user.type(screen.getByLabelText('From address'), 'http://example.org/c.json');
    await user.click(screen.getByRole('button', { name: 'Load' }));
    await screen.findByText(/only allowed for localhost/);
    expect(permissions.request).not.toHaveBeenCalled();
  });
});

describe('options page language', () => {
  it('switches the redesigned areas without reload and never shows catalog keys', async () => {
    const f = { key: 'title', label: 'Headline', required: false, sources: { detect: 'price' } };
    const storage = fakeStorage({
      ...stored(project('p1', 'A', { scope: { allSites: false, domains: ['example.com'] }, fields: [f], siteMappings: { 'example.com': { title: 'h1' } } }), project('p2', 'B')),
      [SETTINGS_KEY]: { language: 'en', appearance: 'light' },
    });
    const user = userEvent.setup();
    render(
      <SettingsProvider storage={storage} subscribe={() => () => {}} media={{ matches: false, addEventListener() {}, removeEventListener() {} }} browserLanguage="en-US">
        <OptionsApp storage={storage} permissions={fakePermissions()} />
      </SettingsProvider>,
    );
    await screen.findByRole('navigation', { name: en['options.nav.label'] });
    expect(screen.getByRole('heading', { name: en['options.scope.title'] })).toBeTruthy();
    await user.click(screen.getByRole('link', { name: 'Settings' }));
    await user.selectOptions(screen.getByLabelText('Language'), 'de');
    await screen.findByRole('navigation', { name: de['options.nav.label'] });
    await user.click(screen.getByRole('link', { name: 'A' }));
    for (const key of ['options.scope.title', 'options.projects.title', 'options.save', 'options.scope.kind.label', 'options.fields.table.source', 'options.fields.table.sites'] as const) {
      expect(screen.getAllByText(de[key]).length, key).toBeGreaterThan(0);
    }
    expect(within(screen.getByRole('main')).getByRole('button', { name: de['options.project.menu'].replace('{name}', 'A') })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: de['options.fields.open'].replace('{name}', 'Headline') }));
    for (const key of ['options.fields.title', 'options.fields.way.label', 'options.fields.add.button', 'options.fields.required', 'options.mappings.title', 'options.fields.deleteButton'] as const) {
      expect(screen.getAllByText(de[key]).length, key).toBeGreaterThan(0);
    }
    const detect = screen.getByLabelText(de['options.fields.detect.label']) as HTMLSelectElement;
    expect([...detect.options].find((o) => o.value === 'price')?.text).toBe(de['popup.detect.price']);
    await user.keyboard('{Escape}');
    expect(document.title).toBe(de['options.title']);
    expect(document.documentElement.dataset.theme).toBe('light');
    await user.click(screen.getByRole('link', { name: de['options.nav.settings'] }));
    await user.click(screen.getByRole('radio', { name: de['settings.appearance.dark'] }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    await user.selectOptions(screen.getByLabelText(de['settings.language.label']), 'en');
    await user.click(screen.getByRole('link', { name: 'A' }));
    await screen.findByRole('heading', { name: en['options.fields.title'] });
    expect(document.body.textContent).not.toMatch(/\boptions\.[a-z]+\.[A-Za-z.]+/);
  });
});


/** Text a person can read: skips collapsed panels, hidden tooltips and the given out-of-scope sections. */
function visibleText(root: HTMLElement, skip: (el: Element) => boolean): string {
  const out: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) out.push(node.textContent ?? '');
    else if (node instanceof HTMLElement && !node.hidden && !skip(node)) node.childNodes.forEach(walk);
  };
  walk(root);
  return out.join(' ');
}

describe('options page vocabulary', () => {
  const f = (key: string, label: string, sources: Record<string, unknown> = {}) => ({ key, label, required: false, sources });
  const FORBIDDEN = /schema\.org|\bmeta\b|\bmeta-tag|selektor|selector|\bheader|\bkey\b|schlüssel/i;
  // The targets section has its own vocabulary test below (it names the access key); import and export are placeholders.
  const outOfScope = (el: Element) =>
    el.classList.contains('options-io') || (el.tagName === 'SECTION' && Boolean(el.querySelector(':scope > h3')?.textContent?.match(/^(Targets?|Ziele?)$/)));

  it.each([['en'], ['de']] as const)('keeps header and Bearer out of the normal targets view in %s', async (language) => {
    const storage = fakeStorage({
      ...stored(project('p1', 'Articles', { targets: [{ id: 't1', name: 'Hook', url: 'https://example.com/hook', headers: ['Authorization', 'X-Extra'], purpose: 'Notes' }] })),
      [HEADER_VALUES_KEY]: { t1: { Authorization: 'Bearer abc', 'X-Extra': 'v' } },
      [SETTINGS_KEY]: { language, appearance: 'light' },
    });
    render(
      <SettingsProvider storage={storage} subscribe={() => () => {}} media={{ matches: false, addEventListener() {}, removeEventListener() {} }} browserLanguage="en-US">
        <OptionsApp storage={storage} permissions={fakePermissions()} />
      </SettingsProvider>,
    );
    const c = language === 'en' ? en : de;
    const heading = await screen.findByRole('heading', { name: c['options.targets.title'], level: 3 });
    const text = visibleText(heading.closest('section') as HTMLElement, () => false);
    expect(text).toContain('Hook');
    expect(text).not.toMatch(/\bheader|bearer|authorization|schl|\bkey\b/i);
    // The access key sits in the details under "Advanced", which a stored key opens.
    await userEvent.setup().click(screen.getByRole('button', { name: c['options.targets.open'].replace('{name}', 'Hook') }));
    const dialog = screen.getByRole('dialog');
    expect(visibleText(dialog, () => false)).toContain(c['options.targets.key']);
    expect(visibleText(dialog, () => false)).not.toMatch(/bearer|authorization/i);
    expect(c['options.targets.key.help']).not.toMatch(/bearer/i);
  });

  it.each([['en'], ['de']] as const)('keeps technical words out of the normal view in %s', async (language) => {
    const storage = fakeStorage({
      ...stored(
        project('p1', 'Articles', {
          scope: { allSites: false, domains: ['example.com'] },
          fields: [
            f('title', 'Headline', { detect: 'title', schemaOrgPath: 'Article.headline' }),
            f('status', 'Status', { manual: { type: 'choice', values: ['Draft'] } }),
            f('price', 'Price'),
          ],
          siteMappings: { 'example.com': { price: '.price' } },
        }),
      ),
      [SETTINGS_KEY]: { language, appearance: 'light' },
    });
    render(
      <SettingsProvider storage={storage} subscribe={() => () => {}} media={{ matches: false, addEventListener() {}, removeEventListener() {} }} browserLanguage="en-US">
        <OptionsApp storage={storage} permissions={fakePermissions()} />
      </SettingsProvider>,
    );
    const c = language === 'en' ? en : de;
    await screen.findByRole('navigation', { name: c['options.nav.label'] });
    const text = visibleText(document.body, outOfScope);
    expect(text.length).toBeGreaterThan(200);
    expect(text).not.toMatch(FORBIDDEN);
    expect(text).toContain(c['options.fields.table.source']);
    // The details of each field keep the technical words under "Advanced" and the selectors in tooltips.
    const user = userEvent.setup();
    for (const name of ['Headline', 'Status', 'Price']) {
      await user.click(screen.getByRole('button', { name: c['options.fields.open'].replace('{name}', name) }));
      const details = visibleText(screen.getByRole('dialog'), () => false);
      expect(details).not.toMatch(FORBIDDEN);
      expect(details).toContain(c['options.fields.way.label']);
      await user.keyboard('{Escape}');
    }
  });
});

describe('options navigation', () => {
  const two = () => fakeStorage(stored(project('p1', 'A'), project('p2', 'B')));
  const nav = () => within(screen.getByRole('navigation', { name: 'Options' }));
  const current = () => nav().getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page').map((a) => a.textContent);

  it('parses and formats addresses, treating malformed ones as the default', () => {
    expect(parseHash('')).toEqual({ view: 'home' });
    expect(parseHash('#/settings')).toEqual({ view: 'settings' });
    expect(parseHash('#/import-export')).toEqual({ view: 'import-export' });
    expect(parseHash('#/help')).toEqual({ view: 'help' });
    expect(parseHash('#/help/x')).toEqual({ view: 'home' });
    expect(parseHash(projectHash('a/b c'))).toEqual({ view: 'project', id: 'a/b c' });
    expect(parseHash('#/projects/%E0%A4%A')).toEqual({ view: 'home' });
    expect(parseHash('#/nonsense')).toEqual({ view: 'home' });
  });

  it('lists the name block, every project and the areas, and marks the current entry', async () => {
    const user = await mount(two());
    expect(screen.getByRole('heading', { name: 'Qatlas Clipper', level: 1 })).toBeTruthy();
    expect(nav().getAllByRole('link').map((a) => a.textContent)).toEqual(['A', 'B', 'Tags', 'Settings', 'Import and export', 'Help']);
    expect(nav().getByRole('button', { name: 'Options for projects' })).toBeTruthy();
    expect(nav().queryByRole('button', { name: /^(Add|From file)/ })).toBeNull();
    expect(current()).toEqual(['A']);
    expect(screen.getByRole('heading', { name: 'A', level: 2 })).toBeTruthy();
    await user.click(nav().getByRole('link', { name: 'B' }));
    expect(current()).toEqual(['B']);
    expect(screen.getByRole('heading', { name: 'B', level: 2 })).toBeTruthy();
    await user.click(nav().getByRole('link', { name: 'Settings' }));
    expect(current()).toEqual(['Settings']);
    expect(screen.getByRole('heading', { name: 'Settings', level: 2 })).toBeTruthy();
    await user.click(nav().getByRole('link', { name: 'Import and export' }));
    expect(current()).toEqual(['Import and export']);
    expect(screen.getByLabelText('From file')).toBeTruthy();
  });

  it('opens the help from its address and marks its entry as the current page', async () => {
    const user = await mount(two(), undefined, '#/help');
    expect(current()).toEqual(['Help']);
    expect(screen.getByRole('heading', { name: 'Help', level: 2 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Project', level: 3 })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    await user.click(nav().getByRole('link', { name: 'A' }));
    expect(current()).toEqual(['A']);
    await user.click(nav().getByRole('link', { name: 'Help' }));
    expect(current()).toEqual(['Help']);
    expect(window.location.hash).toBe('#/help');
  });

  it('moves focus to a section from the jump list without changing the address', async () => {
    const user = await mount(two(), undefined, '#/help');
    Element.prototype.scrollIntoView = vi.fn();
    await user.click(within(screen.getByRole('navigation', { name: 'On this page' })).getByRole('button', { name: 'Formats' }));
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Formats', level: 3 }));
    expect(window.location.hash).toBe('#/help');
  });

  it('treats unknown addresses like before', async () => {
    await mount(two(), undefined, '#/help/other');
    expect(current()).toEqual(['A']);
  });

  it('opens the view of the address and follows browser back and forward', async () => {
    const user = await mount(two(), undefined, '#/projects/p2');
    expect(current()).toEqual(['B']);
    await user.click(nav().getByRole('link', { name: 'Settings' }));
    expect(screen.getByRole('heading', { name: 'Settings', level: 2 })).toBeTruthy();
    act(() => window.history.back());
    await waitFor(() => expect(current()).toEqual(['B']));
    act(() => window.history.forward());
    await waitFor(() => expect(current()).toEqual(['Settings']));
  });

  it('keeps unsaved changes across views and back, shows them in the sidebar and saves them', async () => {
    const storage = two();
    const user = await mount(storage);
    expect(within(screen.getByRole('complementary')).queryByText('Unsaved')).toBeNull();
    const name = screen.getByLabelText('Project name');
    await user.clear(name);
    await user.type(name, 'Renamed');
    expect(within(screen.getByRole('complementary')).getByText('Unsaved')).toBeTruthy();
    await user.click(nav().getByRole('link', { name: 'Settings' }));
    await user.click(nav().getByRole('link', { name: 'Import and export' }));
    act(() => window.history.go(-2));
    await waitFor(() => expect(current()).toEqual(['Renamed']));
    expect(screen.getByLabelText('Project name')).toHaveProperty('value', 'Renamed');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Saved.');
    expect(within(screen.getByRole('complementary')).queryByText('Unsaved')).toBeNull();
    expect((await loadConfig(storage)).projects.map((p) => p.name)).toEqual(['Renamed', 'B']);
  });

  it('tells an unknown project address from having no project', async () => {
    await mount(two(), undefined, '#/projects/missing');
    expect(screen.getByText('Project not found')).toBeTruthy();
    expect(screen.queryByText('No project yet')).toBeNull();
    expect(current()).toEqual([]);
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Go to the first project' }).getAttribute('href')).toBe('#/projects/p1');
    cleanup();
    await mount(fakeStorage(stored()), undefined, '#/projects/missing');
    expect(screen.getByText('Project not found')).toBeTruthy();
    cleanup();
    await mount(fakeStorage(stored()));
    expect(screen.getByText('No project yet')).toBeTruthy();
    expect(screen.queryByText('Project not found')).toBeNull();
  });

  it('falls back to the first project for unknown or malformed addresses', async () => {
    await mount(two(), undefined, '#/projects/%E0%A4%A');
    expect(current()).toEqual(['A']);
  });

  it('opens a new project and moves on after deleting the last one in the list', async () => {
    const user = await mount(two());
    await titleMenu(user, 'Add project');
    expect(current()).toEqual(['New project']);
    expect(window.location.hash).toMatch(/^#\/projects\/.+/);
    await headMenu(user, 'New project', 'Delete project');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete project' }));
    expect(current()).toEqual(['B']);
    await headMenu(user, 'B', 'Delete project');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete project' }));
    await headMenu(user, 'A', 'Delete project');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete project' }));
    expect(screen.getByText('No project yet')).toBeTruthy();
  });
  it('leaves an address that no longer exists after discarding a newly added project', async () => {
    const user = await mount(two());
    await titleMenu(user, 'Add project');
    expect(current()).toEqual(['New project']);
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.queryByText('Project not found')).toBeNull();
    expect(current()).toEqual(['A']);
    expect(window.location.hash).toBe(projectHash('p1'));
  });

  describe('handoff from the popup', () => {
    function channel(initial?: unknown) {
      const area = fakeStorage(initial === undefined ? {} : { [OPTIONS_FOCUS_KEY]: initial });
      const listeners = new Set<() => void>();
      const ch: FocusChannel = { storage: area, onChange: (cb) => (listeners.add(cb), () => listeners.delete(cb)) };
      const request = (projectId: string) => {
        area.data[OPTIONS_FOCUS_KEY] = { projectId, at: Date.now() };
        act(() => listeners.forEach((l) => l()));
      };
      return { ch, area, request };
    }
    const mountWith = async (ch: FocusChannel) => {
      window.location.hash = '';
      const user = userEvent.setup();
      render(<OptionsApp storage={two()} permissions={fakePermissions()} focus={ch} />);
      await screen.findByRole('navigation', { name: 'Options' });
      return user;
    };

    it('shows the requested project at start and clears the request', async () => {
      const { ch, area } = channel({ projectId: 'p2', at: Date.now() });
      await mountWith(ch);
      await waitFor(() => expect(current()).toEqual(['B']));
      expect(area.data[OPTIONS_FOCUS_KEY]).toBeNull();
    });

    it('switches on a later request and keeps the unsaved draft', async () => {
      const { ch, area, request } = channel();
      const user = await mountWith(ch);
      await user.clear(screen.getByLabelText('Project name'));
      await user.type(screen.getByLabelText('Project name'), 'Renamed');
      request('p2');
      await waitFor(() => expect(current()).toEqual(['B']));
      expect(area.data[OPTIONS_FOCUS_KEY]).toBeNull();
      expect(nav().getAllByRole('link').map((a) => a.textContent)).toContain('Renamed');
    });

    it('ignores malformed and stale requests', async () => {
      for (const bad of ['p2', { projectId: 5, at: Date.now() }, { projectId: 'p2', at: 1 }, { projectId: '', at: Date.now() }]) {
        cleanup();
        const { ch } = channel(bad);
        await mountWith(ch);
        await new Promise((r) => setTimeout(r, 0));
        expect(current()).toEqual(['A']);
      }
    });

    it('ends in the not-found view for an unknown id', async () => {
      const { ch } = channel({ projectId: 'gone', at: Date.now() });
      await mountWith(ch);
      expect(await screen.findByText('Project not found')).toBeTruthy();
    });
  });
});

describe('row ids of fields', () => {
  it('follow the same object, then the same key, then the same position, and are new otherwise', async () => {
    const { followIds } = await import('../src/options/draft');
    const a = { key: 'a' };
    const b = { key: 'b' };
    let n = 0;
    const fresh = () => `new${++n}`;
    expect(followIds([a, b], ['1', '2'], [b, a], fresh)).toEqual(['2', '1']);
    expect(followIds([a, b], ['1', '2'], [{ key: 'b' }, { key: 'a' }], fresh)).toEqual(['2', '1']);
    expect(followIds([a, b], ['1', '2'], [a, { key: 'renamed' }], fresh)).toEqual(['1', '2']);
    expect(followIds([a, b], ['1', '2'], [{ key: 'x' }, b, { key: 'y' }], fresh)).toEqual(['1', '2', 'new1']);
  });
});

describe('field format defaults per value way', () => {
  it('starts new fields with text and keeps the format when switching the way', async () => {
    const { newField, setValueWay } = await import('../src/options/draft');
    const created = newField([], 'Price');
    expect(created.format).toBe('text');
    const html = { ...created, format: 'html' as const };
    for (const way of ['detect', 'manual', 'click'] as const) expect(setValueWay(html, way).format).toBe('html');
  });
});

// The test timeout must exceed WAIT, or it would cut the generous waits short.
describe('saving without overwriting', { timeout: 20000 }, () => {
  // Generous wait limit: processing after a storage event can exceed the 1000 ms default under parallel load.
  const WAIT = { timeout: 5000 };
  // Storage that tells its subscribers about every write, like storage.onChanged does for other windows.
  function watched(initial: Record<string, unknown>) {
    const storage = fakeStorage(initial);
    const listeners = new Set<() => void>();
    const origSet = storage.set.bind(storage);
    const fire = () => act(() => listeners.forEach((l) => l()));
    return Object.assign(storage, {
      subscribe: (cb: () => void) => (listeners.add(cb), () => listeners.delete(cb)),
      fire,
      // A write by another window: changes the data, then fires the event.
      foreign: async (change: (data: Record<string, unknown>) => void, silent = false) => {
        change(storage.data);
        if (!silent) fire();
      },
      echo: async (items: Record<string, unknown>) => {
        await origSet(items);
        fire();
      },
    });
  }
  type Watched = ReturnType<typeof watched>;
  const cfg = (data: Record<string, unknown>) => (data[CONFIG_KEY] as { projects: Record<string, unknown>[] });
  const mountWatched = async (storage: Watched) => {
    const user = userEvent.setup();
    window.location.hash = '';
    render(<OptionsApp storage={storage} permissions={fakePermissions()} stored={storage.subscribe} />);
    await screen.findByRole('navigation', { name: 'Options' }, WAIT);
    return user;
  };
  const links = () => within(screen.getByRole('navigation', { name: 'Options' })).getAllByRole('link').map((a) => a.textContent).filter((x) => x !== 'Tags' && x !== 'Settings' && x !== 'Import and export' && x !== 'Help');
  const rename = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
    const input = screen.getByLabelText('Project name');
    await user.clear(input);
    await user.type(input, name);
  };
  const CONFLICT = 'Changes from another window';

  it('shows a foreign change silently when there are no own changes', async () => {
    const storage = watched(stored(project('p1', 'A')));
    await mountWatched(storage);
    await storage.foreign((d) => { cfg(d).projects.push(project('p2', 'B')); });
    await waitFor(() => expect(links()).toContain('B'), WAIT);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Unsaved changes.')).toBeNull();
  });

  it('merges a foreign change with own unsaved changes', async () => {
    const storage = watched(stored(project('p1', 'A')));
    const user = await mountWatched(storage);
    await rename(user, 'Mine');
    await storage.foreign((d) => { cfg(d).projects.push(project('p2', 'B')); });
    await waitFor(() => expect(links()).toEqual(expect.arrayContaining(['Mine', 'B'])), WAIT);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Unsaved changes.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Saved.', {}, WAIT);
    expect((await loadConfig(storage)).projects.map((p) => p.name)).toEqual(['Mine', 'B']);
  });

  it('asks on a conflict, blocks saving until the choice and keeps the own version on request', async () => {
    const storage = watched(stored(project('p1', 'A')));
    const user = await mountWatched(storage);
    await rename(user, 'Mine');
    await storage.foreign((d) => { cfg(d).projects[0]!.name = 'Theirs'; });
    const dialog = await screen.findByRole('dialog', { name: CONFLICT }, WAIT);
    expect(dialog.textContent).toContain('Name of the project "Mine"');
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveProperty('disabled', true);
    // Escape does not decide anything and loses nothing.
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: CONFLICT })).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Close' })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Keep mine' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), WAIT);
    expect(links()).toEqual(['Mine']);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Saved.', {}, WAIT);
    expect((await loadConfig(storage)).projects[0]?.name).toBe('Mine');
  });

  it('takes the other version on request', async () => {
    const storage = watched(stored(project('p1', 'A')));
    const user = await mountWatched(storage);
    await rename(user, 'Mine');
    await storage.foreign((d) => { cfg(d).projects[0]!.name = 'Theirs'; });
    await user.click(within(await screen.findByRole('dialog', { name: CONFLICT }, WAIT)).getByRole('button', { name: 'Take the other' }));
    await waitFor(() => expect(links()).toEqual(['Theirs']), WAIT);
    expect(screen.queryByText('Unsaved changes.')).toBeNull();
  });

  it('does not react to the echo of its own save', async () => {
    const storage = watched(stored(project('p1', 'A')));
    const user = await mountWatched(storage);
    await rename(user, 'Mine');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Saved.', {}, WAIT);
    storage.fire();
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Saved.')).toBeTruthy();
    expect(links()).toEqual(['Mine']);
  });

  it('merges on save when the stored state changed unnoticed and does not lose the foreign change', async () => {
    const storage = watched(stored(project('p1', 'A')));
    const user = await mountWatched(storage);
    await rename(user, 'Mine');
    await storage.foreign((d) => { cfg(d).projects.push(project('p2', 'B')); }, true);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Saved.', {}, WAIT);
    expect((await loadConfig(storage)).projects.map((p) => p.name)).toEqual(['Mine', 'B']);
    expect(links()).toEqual(['Mine', 'B']);
  });

  it('shows the dialog instead of saving when the unnoticed change conflicts', async () => {
    const storage = watched(stored(project('p1', 'A')));
    const user = await mountWatched(storage);
    await rename(user, 'Mine');
    await storage.foreign((d) => { cfg(d).projects[0]!.name = 'Theirs'; }, true);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('dialog', { name: CONFLICT }, WAIT)).toBeTruthy();
    expect(cfg(storage.data).projects[0]!.name).toBe('Theirs');
  });

  it('keeps a renamed field key apart from a mapping another window added for the old key', async () => {
    const field = { key: 'price', label: 'Price', required: false, sources: {} };
    const storage = watched(stored(project('p1', 'A', { fields: [field], siteMappings: { 'example.com': { price: '.a' } } })));
    const user = await mountWatched(storage);
    await user.click(screen.getByRole('button', { name: 'Edit field Price' }));
    const details = within(screen.getByRole('dialog', { name: 'Price' }));
    await user.click(details.getByRole('button', { name: 'Advanced' }));
    const key = details.getByLabelText('Field key', { selector: 'input' });
    await user.clear(key);
    await user.type(key, 'cost');
    await user.keyboard('{Escape}');
    await storage.foreign((d) => { cfg(d).projects[0]!.siteMappings = { 'example.com': { price: '.a' }, 'example.org': { price: '.b' } }; });
    await waitFor(() => expect(screen.getByText('Unsaved changes.')).toBeTruthy(), WAIT);
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Saved.', {}, WAIT);
    const p = (await loadConfig(storage)).projects[0]!;
    expect(p.fields.map((x) => x.key)).toEqual(['cost']);
    expect(p.siteMappings).toEqual({ 'example.com': { cost: '.a' }, 'example.org': { cost: '.b' } });
  });

  it('keeps the open details on their field when another window reorders the fields', async () => {
    const f = (key: string, label: string) => ({ key, label, required: false, sources: {} });
    const storage = watched(stored(project('p1', 'A', { fields: [f('a', 'First'), f('b', 'Second')] })));
    const user = await mountWatched(storage);
    await user.click(screen.getByRole('button', { name: 'Edit field Second' }));
    await storage.foreign((d) => { cfg(d).projects[0]!.fields = [f('b', 'Second'), f('a', 'First')]; });
    await waitFor(() => expect(screen.getAllByRole('row')[1]!.textContent).toContain('Second'), WAIT);
    const details = within(screen.getByRole('dialog', { name: 'Second' }));
    expect((details.getByLabelText('Label') as HTMLInputElement).value).toBe('Second');
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit field Second' }));
  });

  it('discards to the current stored state after a foreign change', async () => {
    const storage = watched(stored(project('p1', 'A')));
    const user = await mountWatched(storage);
    await rename(user, 'Mine');
    await storage.foreign((d) => { cfg(d).projects.push(project('p2', 'B')); });
    await waitFor(() => expect(links()).toContain('B'), WAIT);
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(links()).toEqual(['A', 'B']);
  });

  it('keeps the draft when the stored state is invalid', async () => {
    const storage = watched(stored(project('p1', 'A')));
    const user = await mountWatched(storage);
    await rename(user, 'Mine');
    await storage.foreign((d) => { d[CONFIG_KEY] = { schemaVersion: 1, projects: 'broken' }; });
    await new Promise((r) => setTimeout(r, 10));
    expect(links()).toEqual(['Mine']);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not treat its own import as a foreign change', async () => {
    const storage = watched(stored(project('p1', 'Old')));
    const origSet = storage.set.bind(storage);
    storage.set = async (items) => {
      await origSet(items);
      storage.fire();
    };
    const user = await mountWatched(storage);
    await rename(user, 'Mine');
    await user.click(screen.getByRole('link', { name: 'Import and export' }));
    const file = new File([JSON.stringify({ schemaVersion: 1, projects: [project('n1', 'Imported')] })], 'c.json');
    await user.upload(screen.getByLabelText('From file'), file);
    await user.click(await screen.findByRole('button', { name: 'Replace' }, WAIT));
    expect(await screen.findByRole('link', { name: 'Imported' }, WAIT)).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: CONFLICT })).toBeNull();
  });
});
