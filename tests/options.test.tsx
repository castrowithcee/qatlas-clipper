// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CONFIG_KEY, HEADER_VALUES_KEY, loadConfig, type StorageArea } from '../src/config';
import type { PermissionsApi } from '../src/options/permissions';
import { OptionsApp } from '../src/options/OptionsApp';
import { parseHash, projectHash } from '../src/options/route';
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
const addButton = () => within(screen.getByRole('main')).getByRole('button', { name: 'Add project' });

const addField = async (user: ReturnType<typeof userEvent.setup>, label: string) => {
  await user.type(screen.getByLabelText('Label of the new field'), label);
  await user.click(screen.getByRole('button', { name: 'Add field' }));
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
    const field = screen.getByRole('group', { name: 'Status' });
    await user.click(within(field).getByRole('button', { name: 'Advanced' }));
    await user.type(within(field).getByLabelText('Custom schema.org path'), 'Article.headline');
    await user.selectOptions(within(field).getByLabelText('Where does the value come from?'), 'manual');
    await user.selectOptions(within(field).getByLabelText('Kind of input'), 'choice');
    await user.type(within(field).getByLabelText('Add value'), 'Draft{Enter}Final{Enter}');
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

  it('keeps the page kind list and the custom type apart, the custom type under Advanced', async () => {
    const storage = fakeStorage(stored(project('p1', 'A')));
    const user = await mount(storage);
    const kind = screen.getByLabelText('Only on pages of this kind');
    expect([...(kind as HTMLSelectElement).options].map((o) => o.text)).toEqual([
      'Any kind of page', 'Product', 'Job posting', 'Article', 'Event', 'Recipe', 'Local business',
    ]);
    await user.selectOptions(kind, 'jobPosting');
    expect(screen.getByRole('button', { name: 'Advanced' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByLabelText('Custom page type').closest('[hidden]')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Advanced' }));
    await user.type(screen.getByLabelText('Custom page type'), ' Course ');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Saved.');
    expect((await loadConfig(storage)).projects[0]?.scope).toEqual({ allSites: true, domains: [], pageKind: 'jobPosting', pageType: 'Course' });
    await user.selectOptions(kind, '');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Saved.');
    expect((await loadConfig(storage)).projects[0]?.scope).toEqual({ allSites: true, domains: [], pageType: 'Course' });
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
    const second = within(screen.getByRole('group', { name: 'Second' }));
    expect(second.getByLabelText('Field key').closest('[hidden]')).toBeTruthy();
    await user.click(second.getByRole('button', { name: 'Advanced' }));
    await user.clear(second.getByLabelText('Field key'));
    await user.type(second.getByLabelText('Field key'), 'a');
    expect(second.getByText('This key already belongs to another field.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText(/Not saved/);
    expect(document.activeElement).toBe(second.getByLabelText('Field key'));
    const cfg = await loadConfig(storage);
    expect(cfg.projects[0]?.fields.map((x) => x.key)).toEqual(['a', 'b']);
  });

  it('deletes a project only after confirmation', async () => {
    const storage = fakeStorage(stored(project('p1', 'A'), project('p2', 'B')));
    const user = await mount(storage);
    await user.click(screen.getByRole('button', { name: 'Delete project' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete project?' });
    expect(dialog.textContent).toContain('"A"');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('link', { name: 'A' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Delete project' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete project' }));
    expect(screen.queryByRole('link', { name: 'A' })).toBeNull();
    // The view moves on to the next project.
    expect(screen.getByRole('heading', { name: 'B', level: 2 })).toBeTruthy();
    expect(window.location.hash).toBe('#/projects/p2');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Saved.');
    expect((await loadConfig(storage)).projects.map((p) => p.id)).toEqual(['p2']);
  });

  it('reorders projects and explains the order in a tooltip', async () => {
    const storage = fakeStorage(stored(project('p1', 'A'), project('p2', 'B')));
    const user = await mount(storage);
    expect(screen.getByRole('button', { name: 'Move up project A' })).toHaveProperty('disabled', true);
    await user.click(screen.getByRole('link', { name: 'B' }));
    const up = screen.getByRole('button', { name: 'Move up project B' });
    expect(document.getElementById(up.getAttribute('aria-describedby')!)?.textContent).toMatch(/preselected first in the popup/);
    await user.click(up);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Saved.');
    expect((await loadConfig(storage)).projects.map((p) => p.id)).toEqual(['p2', 'p1']);
  });

  it('shows click mappings by field label with the selector only in the tooltip, and deletes them', async () => {
    const f = (key: string, label: string) => ({ key, label, required: false, sources: {} });
    const storage = fakeStorage(
      stored(project('p1', 'A', {
        fields: [f('title', 'Headline'), f('price', 'Price')],
        siteMappings: { 'example.com': { title: 'h1', price: '.price' }, 'example.org': { title: '.t' } },
      })),
    );
    const user = await mount(storage);
    const group = within(screen.getByRole('region', { name: 'Click mappings for example.com' }));
    expect(group.getByText('Headline')).toBeTruthy();
    expect(group.queryByText('title')).toBeNull();
    const tip = group.getAllByRole('tooltip', { hidden: true })[0]!;
    expect(tip.textContent).toBe('h1');
    expect(tip.hidden).toBe(true);
    expect(screen.queryAllByText('h1').filter((e) => e.getAttribute('role') !== 'tooltip')).toEqual([]);
    await user.click(group.getByRole('button', { name: 'Show saved selection for Headline' }));
    expect(tip.hidden).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Delete mapping Price for example.com' }));
    await user.click(screen.getByRole('button', { name: 'Delete all mappings for example.org' }));
    const headline = within(screen.getByRole('group', { name: 'Headline' }));
    await user.click(headline.getByRole('button', { name: 'Advanced' }));
    const key = headline.getByLabelText('Field key');
    await user.clear(key);
    await user.type(key, 'headline');
    expect(within(screen.getByRole('region', { name: 'Click mappings for example.com' })).getByText('Headline')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Saved.');
    expect((await loadConfig(storage)).projects[0]?.siteMappings).toEqual({ 'example.com': { headline: 'h1' } });
  });

  it('drops site mappings of a deleted field', async () => {
    const f = { key: 'title', label: 'Title', required: false, sources: {} };
    const storage = fakeStorage(stored(project('p1', 'A', { fields: [f], siteMappings: { 'example.com': { title: 'h1' } } })));
    const user = await mount(storage);
    await user.click(screen.getByRole('button', { name: 'Delete field Title' }));
    expect(screen.getByText('No click mappings yet.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Saved.');
    expect((await loadConfig(storage)).projects[0]?.siteMappings).toEqual({});
  });

  describe('fields', () => {
    const f = (key: string, label: string, sources: Record<string, unknown> = {}) => ({ key, label, required: false, sources });

    it('detects a value automatically, derives the key from the label and keeps it when the label changes', async () => {
      const storage = fakeStorage(stored(project('p1', 'A')));
      const user = await mount(storage);
      await addField(user, 'Größe der Straße');
      const field = within(screen.getByRole('group', { name: 'Größe der Straße' }));
      await user.selectOptions(field.getByLabelText('Where does the value come from?'), 'detect');
      await user.selectOptions(field.getByLabelText('What should be detected?'), 'title');
      await user.click(field.getByLabelText('Required'));
      const label = field.getByLabelText('Label');
      await user.clear(label);
      await user.type(label, 'Headline');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await screen.findByText('Saved.');
      expect((await loadConfig(storage)).projects[0]?.fields).toEqual([
        { key: 'groesse_der_strasse', label: 'Headline', required: true, sources: { detect: 'title' } },
      ]);
    });

    it('makes keys unique per project and falls back to "field" for labels without ASCII letters', async () => {
      const user = await mount(fakeStorage(stored(project('p1', 'A'))));
      await addField(user, 'Price');
      await addField(user, 'Price');
      await addField(user, 'Über uns');
      await addField(user, '価格');
      const keys = ['Price', 'Price', 'Über uns', '価格'].map((n, i) => {
        const g = within(screen.getAllByRole('group', { name: n })[i === 1 ? 1 : 0]!);
        return g.getByLabelText('Field key', { selector: 'input' }) as HTMLInputElement;
      });
      expect(keys.map((k) => k.value)).toEqual(['price', 'price_2', 'ueber_uns', 'field']);
    });

    it('takes the click way without any source and removes the detect value and the manual input', async () => {
      const storage = fakeStorage(stored(project('p1', 'A', { fields: [f('title', 'Headline', { detect: 'title', schemaOrgPath: 'Article.headline' })] })));
      const user = await mount(storage);
      const field = within(screen.getByRole('group', { name: 'Headline' }));
      expect((field.getByLabelText('Where does the value come from?') as HTMLSelectElement).value).toBe('detect');
      await user.selectOptions(field.getByLabelText('Where does the value come from?'), 'click');
      expect(field.queryByLabelText('What should be detected?')).toBeNull();
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await screen.findByText('Saved.');
      expect((await loadConfig(storage)).projects[0]?.fields[0]?.sources).toEqual({ schemaOrgPath: 'Article.headline' });
    });

    it('saves a choice list with its chip values, rejects duplicates and needs at least one value', async () => {
      const storage = fakeStorage(stored(project('p1', 'A')));
      const user = await mount(storage);
      await addField(user, 'Status');
      const field = within(screen.getByRole('group', { name: 'Status' }));
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
      const field = within(screen.getByRole('group', { name: 'Summary' }));
      await user.click(field.getByRole('button', { name: 'Advanced' }));
      await user.selectOptions(field.getByLabelText('Meta tag: attribute'), 'property');
      await user.type(field.getByLabelText('Meta tag: name'), 'og:description');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await screen.findByText('Saved.');
      expect((await loadConfig(storage)).projects[0]?.fields[0]?.sources).toEqual({ metaTag: { attribute: 'property', name: 'og:description' } });
    });

    it('reorders and deletes fields with keyboard-reachable buttons and shows the way explanation on focus', async () => {
      const storage = fakeStorage(stored(project('p1', 'A', { fields: [f('a', 'First'), f('b', 'Second')] })));
      const user = await mount(storage);
      await user.click(screen.getByRole('button', { name: 'Move up field Second' }));
      expect(screen.getAllByRole('group').map((g) => g.querySelector('h4')?.textContent)).toEqual(['Second', 'First']);
      const first = within(screen.getByRole('group', { name: 'First' }));
      const help = first.getByRole('button', { name: 'More information' });
      act(() => help.focus());
      expect(document.getElementById(help.getAttribute('aria-describedby')!)?.hidden).toBe(false);
      expect(document.getElementById(help.getAttribute('aria-describedby')!)?.textContent).toMatch(/click the value on the page/);
      await user.click(screen.getByRole('button', { name: 'Delete field Second' }));
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await screen.findByText('Saved.');
      expect((await loadConfig(storage)).projects[0]?.fields.map((x) => x.key)).toEqual(['a']);
    });

    it('shows the label error at the field and the document title in the active language', async () => {
      const user = await mount(fakeStorage(stored(project('p1', 'A', { fields: [f('a', 'First')] }))));
      expect(document.title).toBe('qatlas-clipper options');
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

    async function addTarget(user: ReturnType<typeof userEvent.setup>, url: string) {
      await user.click(screen.getByRole('button', { name: 'Add target' }));
      const url_ = screen.getByLabelText('Target URL');
      await user.clear(url_);
      await user.type(url_, url);
    }

    it('requests the host permission on save, shows the status, keeps header values apart', async () => {
      const storage = fakeStorage(stored(project('p1', 'A')));
      const permissions = fakePermissions();
      const user = await mount(storage, permissions);
      await addTarget(user, 'https://example.com/hook');
      await user.click(screen.getByRole('button', { name: 'Add header to target 1' }));
      await user.type(screen.getByLabelText('Header name 1'), 'Authorization');
      const value = screen.getByLabelText('Header value 1');
      expect(value.getAttribute('type')).toBe('password');
      await user.type(value, 'secret-token');
      expect(screen.getByTestId('permission-0').textContent).toMatch(/not requested/);
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await screen.findByText('Saved.');
      await screen.findByText(/Permission for this address: granted/);
      expect(permissions.request).toHaveBeenCalledWith(['https://example.com/*']);
      const cfg = await loadConfig(storage);
      expect(cfg.projects[0]?.targets[0]).toMatchObject({ url: 'https://example.com/hook', headers: ['Authorization'] });
      expect(JSON.stringify(storage.data[CONFIG_KEY])).not.toContain('secret-token');
      expect(storage.data[HEADER_VALUES_KEY]).toEqual({ [cfg.projects[0]!.targets[0]!.id]: { Authorization: 'secret-token' } });
    });

    it('marks a denied permission and allows asking again; saving does not depend on it', async () => {
      const storage = fakeStorage(stored(project('p1', 'A')));
      const permissions = fakePermissions(false);
      const user = await mount(storage, permissions);
      await addTarget(user, 'https://example.com/hook');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await screen.findByText('Saved.');
      await screen.findByText(/Permission for this address: denied/);
      expect((await loadConfig(storage)).projects[0]?.targets).toHaveLength(1);
      permissions.request.mockImplementationOnce(async (o: string[]) => {
        o.forEach((x) => permissions.granted.add(x));
        return true;
      });
      await user.click(screen.getByRole('button', { name: 'Request permission for target New target' }));
      await screen.findByText(/Permission for this address: granted/);
      expect(permissions.request).toHaveBeenCalledTimes(2);
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
      await user.click(screen.getByRole('button', { name: 'Delete target t1' }));
      await user.click(screen.getByRole('button', { name: 'Delete target t2' }));
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
      expect(screen.getByLabelText('Target URL').getAttribute('aria-invalid')).toBe('true');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await screen.findByText(/Not saved/);
      expect((storage.data[CONFIG_KEY] as { projects: { targets: unknown[] }[] }).projects[0]?.targets).toEqual([]);
      const url = screen.getByLabelText('Target URL');
      await user.clear(url);
      await user.type(url, 'http://localhost:8080/hook');
      expect(screen.queryByText(/only allowed for localhost/)).toBeNull();
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await screen.findByText('Saved.');
      expect((await loadConfig(storage)).projects[0]?.targets[0]?.url).toBe('http://localhost:8080/hook');
    });
  });
});

describe('import and export', () => {
  const target = { id: 't1', name: 'Hook', url: 'https://example.com/hook', headers: ['Authorization'], purpose: '' };
  const imported = JSON.stringify({ schemaVersion: 1, projects: [project('n1', 'Imported 1'), project('n2', 'Imported 2')] });
  const withHeader = () =>
    fakeStorage({ ...stored(project('p1', 'Old', { targets: [target] })), [HEADER_VALUES_KEY]: { t1: { Authorization: 'secret-token' } } });

  afterEach(() => vi.unstubAllGlobals());

  it('exports the saved configuration without header values and says so', async () => {
    const storage = withHeader();
    let blob: Blob | undefined;
    URL.createObjectURL = vi.fn((b: Blob) => ((blob = b), 'blob:x'));
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const user = await mount(storage, fakePermissions(), IMPORT_EXPORT);
    expect(screen.getByText(/Header values are not included/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Export configuration' }));
    await screen.findByText('Exported the saved configuration.');
    const text = await blob!.text();
    expect(text).toContain('Authorization');
    expect(text).not.toContain('secret-token');
    expect(click).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:x');
    click.mockRestore();
  });

  it('replaces the configuration from a file only after confirmation', async () => {
    const storage = withHeader();
    const before = structuredClone(storage.data);
    const user = await mount(storage, fakePermissions(), IMPORT_EXPORT);
    const file = new File([imported], 'c.json', { type: 'application/json' });
    await user.upload(screen.getByLabelText('Import from file'), file);
    const dialog = await screen.findByRole('alertdialog', { name: 'Confirm import' });
    expect(dialog.textContent).toContain('2 projects');
    expect(storage.data).toEqual(before);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog', { name: 'Confirm import' })).toBeNull();
    expect(storage.data).toEqual(before);

    await user.upload(screen.getByLabelText('Import from file'), file);
    await user.click(await screen.findByRole('button', { name: 'Confirm import' }));
    expect(await screen.findByRole('link', { name: 'Imported 1' })).toBeTruthy();
    expect((await loadConfig(storage)).projects.map((p) => p.name)).toEqual(['Imported 1', 'Imported 2']);
  });

  it('shows an error for invalid files without storing and without echoing content', async () => {
    const storage = withHeader();
    const before = structuredClone(storage.data);
    const user = await mount(storage, fakePermissions(), IMPORT_EXPORT);
    await user.upload(screen.getByLabelText('Import from file'), new File(['{"secret-marker":'], 'c.json'));
    const alert = await screen.findByText(/Import failed/);
    expect(alert.textContent).not.toContain('secret-marker');
    expect(storage.data).toEqual(before);
  });

  it('mentions discarded unsaved changes in the confirmation', async () => {
    const user = await mount(withHeader());
    await user.click(screen.getByRole('button', { name: 'Add project' }));
    await user.click(screen.getByRole('link', { name: 'Import and export' }));
    expect(screen.getByText(/Unsaved changes are not exported/)).toBeTruthy();
    await user.upload(screen.getByLabelText('Import from file'), new File([imported], 'c.json'));
    expect((await screen.findByRole('alertdialog', { name: 'Confirm import' })).textContent).toContain('unsaved changes will be discarded');
  });

  it('requests the origin permission, then fetches, previews and replaces only after confirmation', async () => {
    const storage = withHeader();
    const permissions = fakePermissions();
    const fetchMock = vi.fn(async () => new Response(imported));
    vi.stubGlobal('fetch', fetchMock);
    const user = await mount(storage, permissions, IMPORT_EXPORT);
    await user.type(screen.getByLabelText('Import from URL'), 'https://example.org/c.json');
    await user.click(screen.getByRole('button', { name: 'Fetch from URL' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Confirm import' });
    expect(permissions.request).toHaveBeenCalledWith(['https://example.org/*']);
    expect(fetchMock).toHaveBeenCalledWith('https://example.org/c.json', { credentials: 'omit', redirect: 'error' });
    expect(dialog.textContent).toContain('2 projects');
    expect((await loadConfig(storage)).projects.map((p) => p.name)).toEqual(['Old']);
    await user.click(screen.getByRole('button', { name: 'Confirm import' }));
    await screen.findByRole('link', { name: 'Imported 2' });
    expect((await loadConfig(storage)).projects).toHaveLength(2);
  });

  it('does not fetch when the permission is denied', async () => {
    const storage = withHeader();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const user = await mount(storage, fakePermissions(false), IMPORT_EXPORT);
    await user.type(screen.getByLabelText('Import from URL'), 'https://example.org/c.json');
    await user.click(screen.getByRole('button', { name: 'Fetch from URL' }));
    await screen.findByText(/permission for the URL origin was not granted/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog', { name: 'Confirm import' })).toBeNull();
  });

  it('rejects plain http URLs except localhost without asking for permission', async () => {
    const permissions = fakePermissions();
    const user = await mount(withHeader(), permissions, IMPORT_EXPORT);
    await user.type(screen.getByLabelText('Import from URL'), 'http://example.org/c.json');
    await user.click(screen.getByRole('button', { name: 'Fetch from URL' }));
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
    for (const key of ['options.scope.title', 'options.mappings.title', 'options.projects.title', 'options.save', 'options.scope.kind.label'] as const) {
      expect(screen.getAllByText(de[key]).length, key).toBeGreaterThan(0);
    }
    expect(screen.getByRole('button', { name: de['options.projects.moveDown'].replace('{name}', 'A') })).toBeTruthy();
    for (const key of ['options.fields.title', 'options.fields.way.label', 'options.fields.add.button', 'options.fields.required'] as const) {
      expect(screen.getAllByText(de[key]).length, key).toBeGreaterThan(0);
    }
    const detect = screen.getByLabelText(de['options.fields.detect.label']) as HTMLSelectElement;
    expect([...detect.options].find((o) => o.value === 'price')?.text).toBe(de['popup.detect.price']);
    expect(document.title).toBe(de['options.title']);
    expect(document.documentElement.dataset.theme).toBe('light');
    await user.click(screen.getByRole('link', { name: de['options.nav.settings'] }));
    await user.selectOptions(screen.getByLabelText(de['settings.appearance.label']), 'dark');
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
  // Targets and import/export are placeholders until the follow-up task; the settings section is not part of the project view.
  const outOfScope = (el: Element) =>
    el.classList.contains('import-export') || (el.tagName === 'SECTION' && Boolean(el.querySelector(':scope > h3')?.textContent?.match(/^(Targets?|Ziele?)$/)));

  it.each([['en'], ['de']] as const)('keeps technical words out of the normal view in %s', async (language) => {
    const storage = fakeStorage({
      ...stored(
        project('p1', 'Articles', {
          scope: { allSites: false, domains: ['example.com'], pageKind: 'article' },
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
    await screen.findByRole('navigation', { name: (language === 'en' ? en : de)['options.nav.label'] });
    const text = visibleText(document.body, outOfScope);
    expect(text.length).toBeGreaterThan(200);
    expect(text).not.toMatch(FORBIDDEN);
    expect(text).toContain((language === 'en' ? en : de)['options.fields.way.label']);
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
    expect(parseHash(projectHash('a/b c'))).toEqual({ view: 'project', id: 'a/b c' });
    expect(parseHash('#/projects/%E0%A4%A')).toEqual({ view: 'home' });
    expect(parseHash('#/nonsense')).toEqual({ view: 'home' });
  });

  it('lists the name block, every project and the areas, and marks the current entry', async () => {
    const user = await mount(two());
    expect(screen.getByRole('heading', { name: 'qatlas-clipper options', level: 1 })).toBeTruthy();
    expect(nav().getAllByRole('link').map((a) => a.textContent)).toEqual(['A', 'B', 'Settings', 'Import and export']);
    expect(nav().getByRole('button', { name: 'Add project' })).toBeTruthy();
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
    expect(screen.getByLabelText('Import from file')).toBeTruthy();
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
    await user.click(nav().getByRole('button', { name: 'Add project' }));
    expect(current()).toEqual(['New project']);
    expect(window.location.hash).toMatch(/^#\/projects\/.+/);
    await user.click(screen.getByRole('button', { name: 'Delete project' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete project' }));
    expect(current()).toEqual(['B']);
    await user.click(screen.getByRole('button', { name: 'Delete project' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete project' }));
    await user.click(screen.getByRole('button', { name: 'Delete project' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete project' }));
    expect(screen.getByText('No project yet')).toBeTruthy();
  });
});
