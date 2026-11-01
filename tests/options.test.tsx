// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CONFIG_KEY, HEADER_VALUES_KEY, loadConfig, type StorageArea } from '../src/config';
import type { PermissionsApi } from '../src/options/permissions';
import { OptionsApp } from '../src/options/OptionsApp';

afterEach(cleanup);

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

async function mount(storage: StorageArea, permissions: PermissionsApi = fakePermissions()) {
  const user = userEvent.setup();
  render(<OptionsApp storage={storage} permissions={permissions} />);
  await screen.findByRole('heading', { name: 'qatlas-clipper options' });
  return user;
}

describe('options page', () => {
  it('creates a project with scope and field and persists it across re-mount', async () => {
    const storage = fakeStorage();
    const user = await mount(storage);
    await user.click(screen.getByRole('button', { name: 'Add project' }));
    const name = screen.getByLabelText('Project name');
    await user.clear(name);
    await user.type(name, 'Articles');
    await user.selectOptions(screen.getByLabelText('Applies to'), 'domains');
    await user.type(screen.getByLabelText('Domain 1'), 'example.com');
    await user.click(screen.getByRole('button', { name: 'Add domain' }));
    await user.type(screen.getByLabelText('Domain 2'), 'example.org');
    await user.click(screen.getByRole('button', { name: 'Remove domain 2' }));
    await user.type(screen.getByLabelText('Page type'), 'Article');
    expect(screen.queryByLabelText('Regular expression')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add field' }));
    const field = screen.getByRole('group', { name: 'Field 1' });
    await user.type(within(field).getByLabelText('schema.org path'), 'Article.headline');
    await user.selectOptions(within(field).getByLabelText('Manual input'), 'choice');
    await user.type(within(field).getByLabelText('Choice values'), 'Draft{Enter}Final');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Saved.');

    cleanup();
    await mount(storage);
    await user.click(screen.getByRole('button', { name: 'Articles' }));
    expect(screen.getByLabelText('Domain 1')).toHaveProperty('value', 'example.com');
    const saved = await loadConfig(storage);
    expect(saved.projects[0]?.scope).toEqual({ allSites: false, domains: ['example.com'], pageType: 'Article' });
    expect(saved.projects[0]?.fields[0]?.sources).toEqual({
      schemaOrgPath: 'Article.headline',
      manual: { type: 'choice', values: ['Draft', 'Final'] },
    });
  });

  it('rejects an invalid domain at the input and does not save', async () => {
    const storage = fakeStorage(stored(project('p1', 'A', { scope: { allSites: false, domains: ['example.com'] } })));
    const user = await mount(storage);
    const input = screen.getByLabelText('Domain 1');
    await user.clear(input);
    await user.type(input, 'https://example.com/x');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getAllByText(/must be a lowercase host name/).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText(/Not saved/);
    expect((storage.data[CONFIG_KEY] as { projects: { scope: { domains: string[] } }[] }).projects[0]?.scope.domains).toEqual(['example.com']);
    expect(input).toHaveProperty('value', 'https://example.com/x');
  });

  it('changes scope back to all sites, dropping domains, and clears the page type', async () => {
    const storage = fakeStorage(stored(project('p1', 'A', { scope: { allSites: false, domains: ['example.com'], pageType: 'Product' } })));
    const user = await mount(storage);
    await user.selectOptions(screen.getByLabelText('Applies to'), 'all');
    expect(screen.queryByLabelText('Domain 1')).toBeNull();
    await user.clear(screen.getByLabelText('Page type'));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Saved.');
    expect((await loadConfig(storage)).projects[0]?.scope).toEqual({ allSites: true, domains: [] });
  });

  it('rejects a duplicate field key', async () => {
    const f = (key: string) => ({ key, label: key, required: false, sources: {} });
    const storage = fakeStorage(stored(project('p1', 'A', { fields: [f('a'), f('b')] })));
    const user = await mount(storage);
    const second = within(screen.getByRole('group', { name: 'Field 2' }));
    await user.clear(second.getByLabelText('Key'));
    await user.type(second.getByLabelText('Key'), 'a');
    expect(within(screen.getByRole('group', { name: 'Field 2' })).getByText(/duplicate field key/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText(/Not saved/);
    const cfg = await loadConfig(storage);
    expect(cfg.projects[0]?.fields.map((x) => x.key)).toEqual(['a', 'b']);
  });

  it('deletes a project only after confirmation', async () => {
    const storage = fakeStorage(stored(project('p1', 'A'), project('p2', 'B')));
    const user = await mount(storage);
    await user.click(screen.getByRole('button', { name: 'Delete project A' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'A' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Delete project A' }));
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }));
    expect(screen.queryByRole('button', { name: 'A' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Saved.');
    expect((await loadConfig(storage)).projects.map((p) => p.id)).toEqual(['p2']);
  });

  it('reorders projects', async () => {
    const storage = fakeStorage(stored(project('p1', 'A'), project('p2', 'B')));
    const user = await mount(storage);
    expect(screen.getByText(/first one is preselected/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Move up project B' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Saved.');
    expect((await loadConfig(storage)).projects.map((p) => p.id)).toEqual(['p2', 'p1']);
  });

  it('shows and deletes site mappings, and carries them on key rename', async () => {
    const f = (key: string) => ({ key, label: key, required: false, sources: {} });
    const storage = fakeStorage(
      stored(project('p1', 'A', {
        fields: [f('title'), f('price')],
        siteMappings: { 'example.com': { title: 'h1', price: '.price' }, 'example.org': { title: '.t' } },
      })),
    );
    const user = await mount(storage);
    expect(screen.getByText('h1')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Delete mapping price for example.com' }));
    await user.click(screen.getByRole('button', { name: 'Delete all mappings for example.org' }));
    const key = within(screen.getByRole('group', { name: 'Field 1' })).getByLabelText('Key');
    await user.clear(key);
    await user.type(key, 'headline');
    expect(screen.getByText(/\(headline\)/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Saved.');
    expect((await loadConfig(storage)).projects[0]?.siteMappings).toEqual({ 'example.com': { headline: 'h1' } });
  });

  it('drops site mappings of a deleted field', async () => {
    const f = { key: 'title', label: 'Title', required: false, sources: {} };
    const storage = fakeStorage(stored(project('p1', 'A', { fields: [f], siteMappings: { 'example.com': { title: 'h1' } } })));
    const user = await mount(storage);
    await user.click(screen.getByRole('button', { name: 'Delete field title' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Saved.');
    expect((await loadConfig(storage)).projects[0]?.siteMappings).toEqual({});
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
      expect(screen.queryByText(/only allowed for localhost/, { selector: 'p.error' })).toBeNull();
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
    const user = await mount(storage);
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
    const user = await mount(storage);
    const file = new File([imported], 'c.json', { type: 'application/json' });
    await user.upload(screen.getByLabelText('Import from file'), file);
    const dialog = await screen.findByRole('alertdialog', { name: 'Confirm import' });
    expect(dialog.textContent).toContain('2 projects');
    expect(storage.data).toEqual(before);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog', { name: 'Confirm import' })).toBeNull();
    expect(storage.data).toEqual(before);

    await user.upload(screen.getByLabelText('Import from file'), file);
    await user.click(await screen.findByRole('button', { name: 'Confirm import' }));
    expect(await screen.findByRole('button', { name: 'Imported 1' })).toBeTruthy();
    expect((await loadConfig(storage)).projects.map((p) => p.name)).toEqual(['Imported 1', 'Imported 2']);
  });

  it('shows an error for invalid files without storing and without echoing content', async () => {
    const storage = withHeader();
    const before = structuredClone(storage.data);
    const user = await mount(storage);
    await user.upload(screen.getByLabelText('Import from file'), new File(['{"secret-marker":'], 'c.json'));
    const alert = await screen.findByText(/Import failed/);
    expect(alert.textContent).not.toContain('secret-marker');
    expect(storage.data).toEqual(before);
  });

  it('mentions discarded unsaved changes in the confirmation', async () => {
    const user = await mount(withHeader());
    await user.click(screen.getByRole('button', { name: 'Add project' }));
    expect(screen.getByText(/Unsaved changes are not exported/)).toBeTruthy();
    await user.upload(screen.getByLabelText('Import from file'), new File([imported], 'c.json'));
    expect((await screen.findByRole('alertdialog', { name: 'Confirm import' })).textContent).toContain('unsaved changes will be discarded');
  });

  it('requests the origin permission, then fetches, previews and replaces only after confirmation', async () => {
    const storage = withHeader();
    const permissions = fakePermissions();
    const fetchMock = vi.fn(async () => new Response(imported));
    vi.stubGlobal('fetch', fetchMock);
    const user = await mount(storage, permissions);
    await user.type(screen.getByLabelText('Import from URL'), 'https://example.org/c.json');
    await user.click(screen.getByRole('button', { name: 'Fetch from URL' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Confirm import' });
    expect(permissions.request).toHaveBeenCalledWith(['https://example.org/*']);
    expect(fetchMock).toHaveBeenCalledWith('https://example.org/c.json', { credentials: 'omit', redirect: 'error' });
    expect(dialog.textContent).toContain('2 projects');
    expect((await loadConfig(storage)).projects.map((p) => p.name)).toEqual(['Old']);
    await user.click(screen.getByRole('button', { name: 'Confirm import' }));
    await screen.findByRole('button', { name: 'Imported 2' });
    expect((await loadConfig(storage)).projects).toHaveLength(2);
  });

  it('does not fetch when the permission is denied', async () => {
    const storage = withHeader();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const user = await mount(storage, fakePermissions(false));
    await user.type(screen.getByLabelText('Import from URL'), 'https://example.org/c.json');
    await user.click(screen.getByRole('button', { name: 'Fetch from URL' }));
    await screen.findByText(/permission for the URL origin was not granted/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog', { name: 'Confirm import' })).toBeNull();
  });

  it('rejects plain http URLs except localhost without asking for permission', async () => {
    const permissions = fakePermissions();
    const user = await mount(withHeader(), permissions);
    await user.type(screen.getByLabelText('Import from URL'), 'http://example.org/c.json');
    await user.click(screen.getByRole('button', { name: 'Fetch from URL' }));
    await screen.findByText(/only allowed for localhost/);
    expect(permissions.request).not.toHaveBeenCalled();
  });
});
