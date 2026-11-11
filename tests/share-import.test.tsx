// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CONFIG_KEY, HEADER_VALUES_KEY, type Config, type StorageArea } from '../src/config';
import { OptionsApp } from '../src/options/OptionsApp';
import { projectHash } from '../src/options/route';

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

function fakeStorage(initial: Record<string, unknown>): StorageArea & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = { ...initial };
  return {
    data,
    get: async (keys) => Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, structuredClone(data[k])])),
    set: async (items) => void Object.assign(data, structuredClone(items)),
  };
}

const target = { id: 't1', name: 'Hook', url: 'https://example.com/hook', headers: ['Authorization'], purpose: '' };
const project = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, name, scope: { allSites: true, domains: [] }, fields: [], siteMappings: {}, targets: [], ...extra,
});
const storageWith = () =>
  fakeStorage({
    [CONFIG_KEY]: {
      schemaVersion: 1,
      folders: [{ id: 'f1', name: 'Articles' }],
      projects: [project('p1', 'Local', { targets: [target] }), project('p2', 'Blog', { folderId: 'f1' })],
    },
    [HEADER_VALUES_KEY]: { t1: { Authorization: 'secret-token' } },
  });

const share = (projects: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    format: 'qatlas-clipper-share',
    schemaVersion: 1,
    targetsIncluded: false,
    folders: [{ id: 'nf', name: 'Shop' }],
    tags: [{ id: 'nt', name: 'Orders' }],
    projects,
    ...extra,
  });
const fresh = (targets: unknown[] = [], targetsIncluded = false) =>
  share([project('n1', 'Orders', { folderId: 'nf', tagIds: ['nt'], targets })], { targetsIncluded });
const remote = { id: 'rt', name: 'Remote', url: 'https://hooks.example.net/in', headers: [], purpose: '' };

const request = vi.fn(async () => true);
const permissions = { contains: async () => true, request, remove: async () => true };

async function mount(storage: StorageArea, hash = '') {
  const user = userEvent.setup();
  window.location.hash = hash;
  render(<OptionsApp storage={storage} permissions={permissions} />);
  await screen.findByRole('navigation', { name: 'Options' });
  return user;
}
const upload = async (user: ReturnType<typeof userEvent.setup>, text: string, index = 0) => {
  const file = new File([text], 'share.json', { type: 'application/json' });
  await user.upload(screen.getAllByTestId('share-file-input')[index]!, file);
};
const dialog = () => screen.findByRole('dialog', { name: 'Import from file' });
const stored = (s: { data: Record<string, unknown> }) => s.data[CONFIG_KEY] as Config;

describe('share import', () => {
  it('shows no warning without targets and imports folder, tag and project', async () => {
    const storage = storageWith();
    request.mockClear();
    const user = await mount(storage, projectHash('p1'));
    await upload(user, fresh());
    const d = await dialog();
    expect(within(d).queryByRole('alert')).toBeNull();
    expect(within(d).getByText('New folders: Shop.')).toBeTruthy();
    expect(within(d).getByText('New tags: Orders.')).toBeTruthy();
    await user.click(within(d).getByRole('button', { name: 'Import' }));
    await screen.findByText('Imported: 1 project.');
    const config = stored(storage);
    expect(config.projects.map((p) => p.name)).toEqual(['Local', 'Blog', 'Orders']);
    expect(config.folders?.map((f) => f.name)).toEqual(['Articles', 'Shop']);
    expect(config.tags?.map((x) => x.name)).toEqual(['Orders']);
    expect(window.location.hash).toBe(projectHash('n1'));
    expect(request).not.toHaveBeenCalled();
  });

  it('names every target address as text, never as a link, and requests no access', async () => {
    const storage = storageWith();
    request.mockClear();
    const user = await mount(storage);
    const second = { ...remote, id: 'r2', url: 'http://localhost:8787/hook' };
    await upload(user, fresh([remote, second], true));
    const d = await dialog();
    const alert = within(d).getByRole('alert');
    expect(within(alert).getByText('https://hooks.example.net')).toBeTruthy();
    expect(within(alert).getByText('http://localhost:8787')).toBeTruthy();
    expect(alert.querySelector('a')).toBeNull();
    expect(within(alert).getByText(/access keys on this device/i)).toBeTruthy();
    await user.click(within(d).getByRole('button', { name: 'Import' }));
    await screen.findByText('Imported: 1 project.');
    expect(request).not.toHaveBeenCalled();
    expect(storage.data[HEADER_VALUES_KEY]).toEqual({ t1: { Authorization: 'secret-token' } });
  });

  it('does not import a deselected project', async () => {
    const storage = storageWith();
    const user = await mount(storage);
    await upload(user, share([project('n1', 'One'), project('n2', 'Two')], { folders: [], tags: [] }));
    const d = await dialog();
    await user.click(within(d).getByRole('checkbox', { name: 'One' }));
    await user.click(within(d).getByRole('button', { name: 'Import' }));
    await screen.findByText('Imported: 1 project.');
    expect(stored(storage).projects.map((p) => p.name)).toEqual(['Local', 'Blog', 'Two']);
  });

  it('adds an existing project as a copy by default, replace updates it and keeps local targets without targets in the file', async () => {
    const storage = storageWith();
    const user = await mount(storage);
    const text = share([project('p1', 'Local renamed')], { folders: [], tags: [] });
    await upload(user, text);
    let d = await dialog();
    expect(within(d).getByText('Already exists as "Local".')).toBeTruthy();
    expect((within(d).getByRole('combobox') as HTMLSelectElement).value).toBe('copy');
    await user.click(within(d).getByRole('button', { name: 'Import' }));
    await screen.findByText('Imported: 1 project.');
    expect(stored(storage).projects.map((p) => p.name)).toEqual(['Local', 'Blog', 'Local renamed (copy)']);

    await upload(user, text);
    d = await dialog();
    await user.selectOptions(within(d).getByRole('combobox'), 'replace');
    expect(within(d).getByText(/keeps its existing targets/)).toBeTruthy();
    await user.click(within(d).getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(stored(storage).projects).toHaveLength(3));
    const replaced = stored(storage).projects[0];
    expect(replaced?.name).toBe('Local renamed');
    expect(replaced?.targets).toHaveLength(1);
    expect(storage.data[HEADER_VALUES_KEY]).toEqual({ t1: { Authorization: 'secret-token' } });
  });

  it('shows path messages for an invalid file and changes nothing', async () => {
    const storage = storageWith();
    const before = structuredClone(storage.data);
    const user = await mount(storage);
    await upload(user, share([{ id: 'x' }]));
    await screen.findByText(/Import failed/);
    expect(screen.getByText(/projects\[0\]/)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(storage.data).toEqual(before);
  });

  it('cancel changes nothing', async () => {
    const storage = storageWith();
    const before = structuredClone(storage.data);
    const user = await mount(storage);
    await upload(user, fresh());
    await user.click(within(await dialog()).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(storage.data).toEqual(before);
  });

  it('keeps unsaved edits and never replaces the whole configuration', async () => {
    const storage = storageWith();
    const user = await mount(storage, projectHash('p2'));
    await user.type(screen.getByLabelText('Project name'), ' edited');
    await upload(user, fresh());
    const d = await dialog();
    expect(within(d).getByText(/unsaved changes/)).toBeTruthy();
    await user.click(within(d).getByRole('button', { name: 'Import' }));
    await screen.findByText('Imported: 1 project.');
    expect(stored(storage).projects.map((p) => p.name)).toEqual(['Local', 'Blog', 'Orders']);
    window.location.hash = projectHash('p2');
    await screen.findByDisplayValue('Blog edited');
    expect((screen.getByLabelText('Project name') as HTMLInputElement).value).toBe('Blog edited');
    expect(screen.getByText('Unsaved changes.')).toBeTruthy();
    expect(stored(storage).projects[1]?.name).toBe('Blog');
  });

  it('opens the same dialog from all three entries', async () => {
    const user = await mount(storageWith());
    expect(screen.getByRole('button', { name: 'From file: project' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'From file: folder' })).toBeTruthy();
    await upload(user, fresh(), 0);
    await user.click(within(await dialog()).getByRole('button', { name: 'Cancel' }));
    await upload(user, fresh(), 1);
    await user.click(within(await dialog()).getByRole('button', { name: 'Cancel' }));
    window.location.hash = '#/import-export';
    const section = await screen.findByLabelText('File with a selection');
    await user.upload(section, new File([fresh()], 's.json', { type: 'application/json' }));
    await dialog();
  });
});
