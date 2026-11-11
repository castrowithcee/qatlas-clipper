// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CONFIG_KEY, loadConfig, type StorageArea } from '../src/config';
import { OptionsApp } from '../src/options/OptionsApp';
import { projectHash } from '../src/options/route';

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

function fakeStorage(initial: Record<string, unknown>): StorageArea & { data: Record<string, unknown> } {
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
const stored = (folders: { id: string; name: string }[], ...projects: unknown[]) => ({ [CONFIG_KEY]: { schemaVersion: 1, folders, projects } });

const FOLDERS = [{ id: 'f1', name: 'Articles' }, { id: 'f2', name: 'Shop' }];
const base = () =>
  fakeStorage(stored(FOLDERS, project('p1', 'Loose'), project('p2', 'Blog', { folderId: 'f1' }), project('p3', 'Store', { folderId: 'f2' })));

async function mount(storage: StorageArea, hash = '') {
  const user = userEvent.setup();
  window.location.hash = hash;
  render(<OptionsApp storage={storage} />);
  await screen.findByRole('navigation', { name: 'Options' });
  return user;
}

const nav = () => screen.getByRole('navigation', { name: 'Options' });
const folderNames = () => within(nav()).getAllByTestId('options-folder').map((li) => li.querySelector('.options-folder-name')?.textContent);
const toggle = (name: string) => within(nav()).getByRole('button', { name: new RegExp(`^${name}`) });
const menuOf = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await user.click(within(nav()).getByRole('button', { name: `Menu for folder ${name}` }));
};
const save = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Save changes' }));
const unsaved = () => within(screen.getByRole('complementary')).queryByText('Unsaved');

describe('folders in the sidebar', () => {
  it('lists projects without a folder first, then the folders; the folder of the open project is expanded', async () => {
    await mount(base(), projectHash('p2'));
    const list = within(nav()).getByRole('list', { name: 'Projects' });
    const top = Array.from(list.children).map((li) => li.className);
    expect(top[0]).toBe('');
    expect(within(list.children[0] as HTMLElement).getByText('Loose')).toBeTruthy();
    expect(folderNames()).toEqual(['Articles', 'Shop']);
    expect(toggle('Articles').getAttribute('aria-expanded')).toBe('true');
    expect(toggle('Shop').getAttribute('aria-expanded')).toBe('false');
  });

  it('shows an empty folder and opens and closes folders with the keyboard', async () => {
    const storage = fakeStorage(stored([{ id: 'f1', name: 'Empty' }], project('p1', 'Loose')));
    const user = await mount(storage);
    const btn = toggle('Empty');
    expect(within(nav()).getByTestId('options-folder-count').textContent).toBe('0');
    btn.focus();
    await user.keyboard('{Enter}');
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(within(nav()).getByText('No projects')).toBeTruthy();
    await user.keyboard(' ');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('renders folder names as text only', async () => {
    const storage = fakeStorage(stored([{ id: 'f1', name: '<img src=x onerror=alert(1)>' }], project('p1', 'Loose')));
    await mount(storage);
    expect(nav().querySelector('img[src="x"]')).toBeNull();
    expect(nav().textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('adds a folder through the draft and stores it only with Save; a duplicate name is a field error', async () => {
    const storage = base();
    const user = await mount(storage);
    await user.click(within(nav()).getByRole('button', { name: 'Add folder' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add folder' });
    const input = within(dialog).getByLabelText('Folder name');
    await user.type(input, ' shop ');
    expect(within(dialog).getByText('A folder with this name already exists.')).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('dialog', { name: 'Add folder' })).toBeTruthy();
    await user.clear(input);
    await user.type(input, 'Notes');
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(folderNames()).toEqual(['Articles', 'Shop', 'Notes']);
    expect(unsaved()).toBeTruthy();
    expect((await loadConfig(storage)).folders).toHaveLength(2);
    await save(user);
    await screen.findByText('Saved.');
    expect((await loadConfig(storage)).folders?.map((f) => f.name)).toEqual(['Articles', 'Shop', 'Notes']);
  });

  it('rejects an empty name', async () => {
    const user = await mount(base());
    await user.click(within(nav()).getByRole('button', { name: 'Add folder' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(within(dialog).getByText('Please enter a name.')).toBeTruthy();
  });

  it('renames a folder, rejecting a name another folder has', async () => {
    const storage = base();
    const user = await mount(storage);
    await menuOf(user, 'Articles');
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rename folder' });
    const input = within(dialog).getByLabelText('Folder name') as HTMLInputElement;
    expect(input.value).toBe('Articles');
    await user.clear(input);
    await user.type(input, 'SHOP');
    expect(within(dialog).getByText('A folder with this name already exists.')).toBeTruthy();
    await user.clear(input);
    await user.type(input, 'Texts');
    await user.click(within(dialog).getByRole('button', { name: 'Rename' }));
    expect(folderNames()).toEqual(['Texts', 'Shop']);
    expect(unsaved()).toBeTruthy();
    await save(user);
    await screen.findByText('Saved.');
    expect((await loadConfig(storage)).folders?.[0]?.name).toBe('Texts');
  });

  it('moves a folder up and down; edges offer only one direction', async () => {
    const storage = base();
    const user = await mount(storage);
    await menuOf(user, 'Articles');
    expect(screen.queryByRole('menuitem', { name: 'Move up' })).toBeNull();
    await user.click(screen.getByRole('menuitem', { name: 'Move down' }));
    expect(folderNames()).toEqual(['Shop', 'Articles']);
    await menuOf(user, 'Articles');
    expect(screen.queryByRole('menuitem', { name: 'Move down' })).toBeNull();
    await user.click(screen.getByRole('menuitem', { name: 'Move up' }));
    expect(folderNames()).toEqual(['Articles', 'Shop']);
    await menuOf(user, 'Shop');
    await user.click(screen.getByRole('menuitem', { name: 'Move up' }));
    await save(user);
    await screen.findByText('Saved.');
    expect((await loadConfig(storage)).folders?.map((f) => f.name)).toEqual(['Shop', 'Articles']);
  });

  it('deletes a folder after confirming; its projects stay without a folder', async () => {
    const storage = base();
    const user = await mount(storage, projectHash('p2'));
    await menuOf(user, 'Articles');
    await user.click(screen.getByRole('menuitem', { name: 'Delete folder' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete folder?' });
    expect(dialog.textContent).toContain('Its projects are kept');
    expect(within(dialog).getByRole('button', { name: 'Delete folder' }).className).toContain('q-button--danger');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(folderNames()).toEqual(['Articles', 'Shop']);
    await menuOf(user, 'Articles');
    await user.click(screen.getByRole('menuitem', { name: 'Delete folder' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete folder' }));
    expect(folderNames()).toEqual(['Shop']);
    const list = within(nav()).getByRole('list', { name: 'Projects' });
    expect(within(list.children[0] as HTMLElement).getByText('Loose')).toBeTruthy();
    expect(within(list.children[1] as HTMLElement).getByText('Blog')).toBeTruthy();
    await save(user);
    await screen.findByText('Saved.');
    const config = await loadConfig(storage);
    expect(config.folders?.map((f) => f.id)).toEqual(['f2']);
    expect(config.projects.find((p) => p.id === 'p2')?.folderId).toBeUndefined();
  });
});

describe('folder choice in the project editor', () => {
  it('moves a project into a folder and out again, saved with Save', async () => {
    const storage = base();
    const user = await mount(storage, projectHash('p1'));
    const select = screen.getByLabelText('Folder') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['No folder', 'Articles', 'Shop']);
    expect(select.value).toBe('');
    await user.selectOptions(select, 'Shop');
    expect(unsaved()).toBeTruthy();
    expect(within(nav()).getAllByTestId('options-folder-count').map((c) => c.textContent)).toEqual(['1', '2']);
    expect(toggle('Shop').getAttribute('aria-expanded')).toBe('true');
    expect((await loadConfig(storage)).projects[0]?.folderId).toBeUndefined();
    await save(user);
    await screen.findByText('Saved.');
    expect((await loadConfig(storage)).projects[0]?.folderId).toBe('f2');
    await user.selectOptions(screen.getByLabelText('Folder'), 'No folder');
    await save(user);
    await vi_waitUnsaved();
    expect((await loadConfig(storage)).projects[0]?.folderId).toBeUndefined();
  });
});

async function vi_waitUnsaved() {
  await screen.findAllByText('Saved.');
  await new Promise((r) => setTimeout(r, 0));
}
