// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
  await user.click(within(nav()).getByRole('button', { name: `Options for folder ${name}` }));
};
const titleMenu = async (user: ReturnType<typeof userEvent.setup>, entry: string) => {
  await user.click(within(nav()).getByRole('button', { name: 'Options for projects' }));
  await user.click(screen.getByRole('menuitem', { name: entry }));
};
const projectMenu = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await user.click(within(nav()).getByRole('button', { name: `Options for project ${name}` }));
};
const save = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Save changes' }));
const unsaved = () => within(screen.getByRole('complementary')).queryByText('Unsaved');

describe('folders in the sidebar', () => {
  it('lists projects without a folder first, then the folders; the folder of the open project is expanded', async () => {
    await mount(base(), projectHash('p2'));
    const list = within(nav()).getByRole('list', { name: 'Projects' });
    const top = Array.from(list.children).map((li) => li.className);
    expect(top[0]).toBe('options-row');
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

  const nameField = () => within(nav()).getByLabelText('Folder name') as HTMLInputElement;

  it('adds a folder at once with a free default name and a focused, selected name field', async () => {
    const storage = base();
    const user = await mount(storage);
    await titleMenu(user, 'Add folder');
    expect(screen.queryByRole('dialog')).toBeNull();
    const input = nameField();
    expect(input.value).toBe('New folder');
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('New folder'.length);
    expect(unsaved()).toBeTruthy();
    await user.keyboard('Notes{Enter}');
    expect(within(nav()).queryByLabelText('Folder name')).toBeNull();
    expect(folderNames()).toEqual(['Articles', 'Shop', 'Notes']);
    expect(document.activeElement).toBe(toggle('Notes'));
    expect((await loadConfig(storage)).folders).toHaveLength(2);
    await save(user);
    await screen.findByText('Saved.');
    expect((await loadConfig(storage)).folders?.map((f) => f.name)).toEqual(['Articles', 'Shop', 'Notes']);
  });

  it('numbers the default name when it is taken', async () => {
    const user = await mount(fakeStorage(stored([{ id: 'f1', name: 'new FOLDER' }], project('p1', 'Loose'))));
    await titleMenu(user, 'Add folder');
    expect(nameField().value).toBe('New folder 2');
  });

  it('takes the name on blur and keeps the default name on Escape', async () => {
    const user = await mount(base());
    await titleMenu(user, 'Add folder');
    await user.keyboard('Blurred');
    await user.click(document.body);
    expect(folderNames()).toEqual(['Articles', 'Shop', 'Blurred']);
    await titleMenu(user, 'Add folder');
    await user.keyboard('Gone{Escape}');
    expect(within(nav()).queryByLabelText('Folder name')).toBeNull();
    expect(folderNames()).toEqual(['Articles', 'Shop', 'Blurred', 'New folder']);
  });

  it('shows duplicate, empty and too long names as a field error and keeps the focus and the input', async () => {
    const user = await mount(base());
    await titleMenu(user, 'Add folder');
    const input = nameField();
    await user.keyboard(' shop ');
    expect(within(nav()).getByText('A folder with this name already exists.')).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const errorId = input.getAttribute('aria-describedby')!;
    expect(document.getElementById(errorId)?.textContent).toContain('A folder with this name already exists.');
    await user.keyboard('{Enter}');
    expect(nameField().value).toBe(' shop ');
    expect(document.activeElement).toBe(nameField());
    await user.clear(input);
    await user.keyboard('{Enter}');
    expect(within(nav()).getByText('Please enter a name.')).toBeTruthy();
    await user.clear(input);
    await user.type(input, 'x'.repeat(61));
    expect(within(nav()).getByText('The name must be at most 60 characters.')).toBeTruthy();
    // Leaving with an invalid name returns the focus to the field.
    await user.click(document.body);
    await waitFor(() => expect(document.activeElement).toBe(nameField()));
    expect(nameField().value).toBe('x'.repeat(61));
  });

  it('lets Escape out of an invalid name; the draft keeps the last valid name', async () => {
    const user = await mount(base());
    await titleMenu(user, 'Add folder');
    await user.keyboard('Shop{Escape}');
    expect(within(nav()).queryByLabelText('Folder name')).toBeNull();
    expect(folderNames()).toEqual(['Articles', 'Shop', 'New folder']);
    await menuOf(user, 'Articles');
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
    await user.keyboard('{Escape}');
    expect(folderNames()).toEqual(['Articles', 'Shop', 'New folder']);
  });

  it('renames a folder in its row, rejecting a name another folder has', async () => {
    const storage = base();
    const user = await mount(storage);
    await menuOf(user, 'Articles');
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    const input = nameField();
    expect(input.value).toBe('Articles');
    expect(document.activeElement).toBe(input);
    await user.clear(input);
    await user.type(input, 'SHOP');
    expect(within(nav()).getByText('A folder with this name already exists.')).toBeTruthy();
    await user.clear(input);
    await user.type(input, 'Texts{Enter}');
    expect(folderNames()).toEqual(['Texts', 'Shop']);
    expect(unsaved()).toBeTruthy();
    await save(user);
    await screen.findByText('Saved.');
    expect((await loadConfig(storage)).folders?.[0]?.name).toBe('Texts');
  });

  it('keeps an unchanged name as it is without marking the draft', async () => {
    const user = await mount(base());
    await menuOf(user, 'Articles');
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
    await user.keyboard('{Enter}');
    expect(unsaved()).toBeNull();
  });

  it('moves a folder up and down; edges offer only one direction', async () => {
    const storage = base();
    const user = await mount(storage);
    await menuOf(user, 'Articles');
    expect(screen.getByRole('menuitem', { name: 'Move up' }).getAttribute('aria-disabled')).toBe('true');
    await user.click(screen.getByRole('menuitem', { name: 'Move down' }));
    expect(folderNames()).toEqual(['Shop', 'Articles']);
    await menuOf(user, 'Articles');
    expect(screen.getByRole('menuitem', { name: 'Move down' }).getAttribute('aria-disabled')).toBe('true');
    await user.click(screen.getByRole('menuitem', { name: 'Move up' }));
    expect(folderNames()).toEqual(['Articles', 'Shop']);
    await menuOf(user, 'Shop');
    await user.click(screen.getByRole('menuitem', { name: 'Move up' }));
    await save(user);
    await screen.findByText('Saved.');
    expect((await loadConfig(storage)).folders?.map((f) => f.name)).toEqual(['Shop', 'Articles']);
  });

  it('offers the folder menu with a separator before the danger entry', async () => {
    const user = await mount(base());
    await menuOf(user, 'Articles');
    const menu = screen.getByRole('menu', { name: 'Options for folder Articles' });
    expect(Array.from(menu.children).map((c) => c.getAttribute('role') === 'separator' ? '-' : c.textContent)).toEqual(['Rename', 'Move up', 'Move down', 'Export', '-', 'Delete folder']);
    expect(screen.getByRole('menuitem', { name: 'Delete folder' }).className).toContain('q-menu-item--danger');
    expect(menu.querySelectorAll('.q-menu-item--danger')).toHaveLength(1);
  });

  it('offers the title menu with create and from-file entries and no embedded buttons', async () => {
    const user = await mount(base());
    expect(within(nav()).queryByRole('button', { name: /^(Add project|Add folder|From file)/ })).toBeNull();
    await user.click(within(nav()).getByRole('button', { name: 'Options for projects' }));
    const menu = screen.getByRole('menu', { name: 'Options for projects' });
    expect(Array.from(menu.children).map((c) => c.getAttribute('role') === 'separator' ? '-' : c.textContent)).toEqual(['Add project', 'Project from file', '-', 'Add folder', 'Folder from file']);
    await user.click(screen.getByRole('menuitem', { name: 'Add project' }));
    expect(screen.getAllByRole('link', { name: 'New project' }).length).toBe(1);
  });

  it('moves a project only within its group and disables the edges', async () => {
    const storage = fakeStorage(stored(FOLDERS, project('p1', 'Loose A'), project('p2', 'Blog', { folderId: 'f1' }), project('p4', 'Loose B'), project('p5', 'News', { folderId: 'f1' })));
    const user = await mount(storage, projectHash('p2'));
    await projectMenu(user, 'Loose A');
    expect(screen.getByRole('menuitem', { name: 'Move up' }).getAttribute('aria-disabled')).toBe('true');
    await user.click(screen.getByRole('menuitem', { name: 'Move down' }));
    await projectMenu(user, 'Loose A');
    expect(screen.getByRole('menuitem', { name: 'Move down' }).getAttribute('aria-disabled')).toBe('true');
    await user.keyboard('{Escape}');
    await projectMenu(user, 'Blog');
    await user.click(screen.getByRole('menuitem', { name: 'Move down' }));
    await save(user);
    await screen.findByText('Saved.');
    expect((await loadConfig(storage)).projects.map((p) => p.name)).toEqual(['Loose B', 'News', 'Loose A', 'Blog']);
  });

  it('deletes exactly the project of the row after confirming while another one is open', async () => {
    const storage = base();
    const user = await mount(storage, projectHash('p1'));
    await user.click(toggle('Articles'));
    await projectMenu(user, 'Blog');
    await user.click(screen.getByRole('menuitem', { name: 'Delete project' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete project?' });
    expect(dialog.textContent).toContain('Blog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(within(nav()).getByRole('link', { name: 'Blog' })).toBeTruthy();
    await projectMenu(user, 'Blog');
    await user.click(screen.getByRole('menuitem', { name: 'Delete project' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete project' }));
    expect(within(nav()).queryByRole('link', { name: 'Blog' })).toBeNull();
    expect(within(nav()).getByRole('link', { name: 'Loose' }).getAttribute('aria-current')).toBe('page');
    expect((await loadConfig(storage)).projects).toHaveLength(3);
    await save(user);
    await screen.findByText('Saved.');
    expect((await loadConfig(storage)).projects.map((p) => p.name)).toEqual(['Loose', 'Store']);
  });

  it('reaches the row menu with the keyboard and shows it for focus within the row', async () => {
    const user = await mount(base());
    const link = within(nav()).getByRole('link', { name: 'Loose' });
    link.focus();
    await user.tab();
    expect(document.activeElement).toBe(within(nav()).getByRole('button', { name: 'Options for project Loose' }));
    await user.keyboard('{Enter}');
    expect(screen.getByRole('menu', { name: 'Options for project Loose' })).toBeTruthy();
  });

  it('exports the project of the row', async () => {
    const user = await mount(base(), projectHash('p1'));
    await user.click(toggle('Shop'));
    await projectMenu(user, 'Store');
    await user.click(screen.getByRole('menuitem', { name: 'Export' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('1 project');
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
