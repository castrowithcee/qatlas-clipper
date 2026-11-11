// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CONFIG_KEY, loadConfig, type StorageArea } from '../src/config';
import { OptionsApp } from '../src/options/OptionsApp';
import { projectHash, parseHash } from '../src/options/route';

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
const TAGS = [{ id: 't1', name: 'Client' }, { id: 't2', name: 'Draft' }, { id: 't3', name: 'Archive' }];
const base = () =>
  fakeStorage({
    [CONFIG_KEY]: {
      schemaVersion: 1,
      folders: [{ id: 'f1', name: 'Work' }, { id: 'f2', name: 'Misc' }, { id: 'f3', name: 'Empty' }],
      tags: TAGS,
      projects: [
        project('p1', 'Loose', { tagIds: ['t1', 't2'] }),
        project('p2', 'Blog', { folderId: 'f1', tagIds: ['t2'] }),
        project('p3', 'Store', { folderId: 'f2', tagIds: ['t3'] }),
        project('p4', 'Plain', { folderId: 'f2' }),
      ],
    },
  });

async function mount(storage: StorageArea, hash = '') {
  const user = userEvent.setup();
  window.location.hash = hash;
  const view = render(<OptionsApp storage={storage} />);
  await screen.findByRole('navigation', { name: 'Options' });
  return { user, view };
}
type User = ReturnType<typeof userEvent.setup>;
const nav = () => screen.getByRole('navigation', { name: 'Options' });
const save = (user: User) => user.click(screen.getByRole('button', { name: 'Save changes' }));
const rows = () => screen.getAllByTestId('options-tag').map((li) => [li.querySelector('.options-tag-name')?.textContent, li.querySelector('.options-tag-count')?.textContent]);
const chips = () => within(screen.getByRole('list', { name: 'Assigned tags' })).getAllByRole('listitem').map((li) => li.textContent);
const sidebarProjects = () => within(nav()).getByRole('list', { name: 'Projects' });
const filterButton = (name: string) => within(nav()).getByRole('button', { name });
const visibleNames = () =>
  Array.from(sidebarProjects().querySelectorAll('a.options-nav-link')).filter((a) => !a.closest('[hidden]')).map((a) => a.textContent);
const folderRows = () => within(nav()).queryAllByTestId('options-folder').map((li) => li.querySelector('.options-folder-name')?.textContent);

describe('tag area', () => {
  it('has its own address and a sidebar entry between the projects and the settings', async () => {
    expect(parseHash('#/tags')).toEqual({ view: 'tags' });
    await mount(base(), '#/tags');
    const links = within(nav()).getAllByRole('link').map((a) => a.textContent);
    expect(links.slice(-4)).toEqual(['Tags', 'Settings', 'Import and export', 'Help']);
    expect(within(nav()).getByRole('link', { name: 'Tags' }).getAttribute('aria-current')).toBe('page');
    expect(rows()).toEqual([['Client', '1 project'], ['Draft', '2 projects'], ['Archive', '1 project']]);
  });

  it('adds a tag through the draft; a duplicate in another spelling is a field error; saved only with Save', async () => {
    const storage = base();
    const { user } = await mount(storage, '#/tags');
    const input = screen.getByLabelText('Tag name');
    await user.type(input, ' client ');
    expect(screen.getByText('A tag with this name already exists.')).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    await user.keyboard('{Enter}');
    expect(rows()).toHaveLength(3);
    await user.clear(input);
    await user.type(input, 'x'.repeat(61));
    expect(screen.getByText('The name must be at most 60 characters.')).toBeTruthy();
    await user.clear(input);
    await user.click(screen.getByRole('button', { name: 'Add tag' }));
    expect(screen.getByText('Please enter a name.')).toBeTruthy();
    await user.type(input, 'Gadget{Enter}');
    expect(rows().map((r) => r[0])).toEqual(['Client', 'Draft', 'Archive', 'Gadget']);
    expect((await loadConfig(storage)).tags).toHaveLength(3);
    await save(user);
    await screen.findByText('Saved.');
    expect((await loadConfig(storage)).tags?.map((x) => x.name)).toEqual(['Client', 'Draft', 'Archive', 'Gadget']);
  });

  const menuOf = (user: User, name: string, item: string) => async () => {
    await user.click(screen.getByRole('button', { name: `Options for tag ${name}` }));
    await user.click(await screen.findByRole('menuitem', { name: item }));
  };

  it('renames a tag in its row for all projects; a taken name is a field error and Escape keeps the name', async () => {
    const storage = base();
    const { user } = await mount(storage, '#/tags');
    await menuOf(user, 'Draft', 'Rename')();
    const input = screen.getByRole('textbox', { name: 'Rename tag Draft' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(input === document.activeElement).toBe(true);
    await user.clear(input);
    await user.type(input, 'CLIENT');
    expect(screen.getByText('A tag with this name already exists.')).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('textbox', { name: 'Rename tag Draft' })).toBeTruthy();
    // Leaving the field with an invalid name keeps it open.
    await user.tab();
    expect(screen.getByRole('textbox', { name: 'Rename tag Draft' })).toBeTruthy();
    await user.click(input);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Rename tag Draft' })).toBeNull();
    expect(rows()[1]).toEqual(['Draft', '2 projects']);
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    await menuOf(user, 'Draft', 'Rename')();
    const again = screen.getByRole('textbox', { name: 'Rename tag Draft' });
    await user.clear(again);
    await user.type(again, 'Review');
    await user.keyboard('{Enter}');
    expect(rows()[1]).toEqual(['Review', '2 projects']);
    for (const [id, expected] of [['p1', ['Client', 'Review']], ['p2', ['Review']]] as const) {
      window.location.hash = projectHash(id);
      await screen.findByLabelText('Project name');
      expect(chips()).toEqual(expected);
    }
    await save(user);
    await screen.findByText('Saved.');
    expect((await loadConfig(storage)).tags?.[1]?.name).toBe('Review');
  });

  it('has a compact list with a menu per row, the danger item only behind a separator', async () => {
    await mount(base(), '#/tags');
    const row = screen.getAllByTestId('options-tag')[0]!;
    expect(row.querySelector('.q-button--danger')).toBeNull();
    expect(within(row).queryByRole('button', { name: /Rename|Delete/ })).toBeNull();
    const user = userEvent.setup();
    await user.click(within(row).getByRole('button', { name: 'Options for tag Client' }));
    const menu = screen.getByRole('menu');
    const kinds = Array.from(menu.children).map((c) => c.getAttribute('role'));
    expect(kinds).toEqual(['menuitem', 'separator', 'menuitem']);
    expect(within(menu).getByRole('menuitem', { name: 'Delete tag' }).className).toContain('q-menu-item--danger');
    // The intro text sits in the tooltip of the info button at the heading.
    const info = within(screen.getByRole('main')).getByRole('button', { name: 'More information' });
    expect(document.getElementById(info.getAttribute('aria-describedby')!)?.textContent).toMatch(/Tags mark projects across folders, for example by client/);
    expect(document.querySelector('.options-tags-view > p')).toBeNull();
  });

  it('asks before deleting, names the number of projects and uses the danger color', async () => {
    const storage = base();
    const { user } = await mount(storage, '#/tags');
    await menuOf(user, 'Draft', 'Delete tag')();
    const dialog = await screen.findByRole('dialog', { name: 'Delete tag?' });
    expect(dialog.textContent).toContain('removed from 2 projects');
    expect(within(dialog).getByRole('button', { name: 'Delete tag' }).className).toContain('q-button--danger');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(rows()).toHaveLength(3);
    await menuOf(user, 'Archive', 'Delete tag')();
    expect((await screen.findByRole('dialog')).textContent).toContain('removed from 1 project;');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete tag' }));
    await menuOf(user, 'Draft', 'Delete tag')();
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete tag' }));
    expect(rows()).toEqual([['Client', '1 project']]);
    await save(user);
    await screen.findByText('Saved.');
    const config = await loadConfig(storage);
    expect(config.tags?.map((x) => x.id)).toEqual(['t1']);
    expect(config.projects.map((p) => p.tagIds)).toEqual([['t1'], undefined, undefined, undefined]);
  });

  it('renders tag names as text only', async () => {
    const storage = fakeStorage({ [CONFIG_KEY]: { schemaVersion: 1, tags: [{ id: 't1', name: '<img src=x onerror=alert(1)>' }], projects: [project('p1', 'A', { tagIds: ['t1'] })] } });
    await mount(storage, projectHash('p1'));
    expect(document.body.querySelector('img[src="x"]')).toBeNull();
    expect(chips()).toEqual(['<img src=x onerror=alert(1)>']);
    expect(within(nav()).getByRole('button', { name: '<img src=x onerror=alert(1)>' })).toBeTruthy();
  });
});

describe('tags in the project editor', () => {
  const field = () => screen.getByRole('combobox', { name: 'Tags' }) as HTMLInputElement;

  it('assigns an existing tag from the suggestions by keyboard and removes it with its chip', async () => {
    const storage = base();
    const { user } = await mount(storage, projectHash('p4'));
    expect(screen.queryByRole('list', { name: 'Assigned tags' })).toBeNull();
    field().focus();
    await user.keyboard('{ArrowDown}');
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Client', 'Draft', 'Archive']);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.keyboard('ar');
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Archive']);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(chips()).toEqual(['Archive']);
    expect(field().value).toBe('');
    expect((await loadConfig(storage)).projects[3]?.tagIds).toBeUndefined();
    await user.type(field(), 'Draft{Enter}');
    // Chips follow the order of the central tag list.
    expect(chips()).toEqual(['Draft', 'Archive']);
    await save(user);
    await screen.findByText('Saved.');
    expect((await loadConfig(storage)).projects[3]?.tagIds).toEqual(['t3', 't2']);
    // The chip's remove button is a normal button, reachable and usable with the keyboard.
    const remove = screen.getByRole('button', { name: 'Remove tag Archive' });
    remove.focus();
    await user.keyboard('{Enter}');
    expect(chips()).toEqual(['Draft']);
    await user.click(screen.getByRole('button', { name: 'Remove tag Draft' }));
    expect(screen.queryByRole('list', { name: 'Assigned tags' })).toBeNull();
    await save(user);
    await vi_saved();
    expect((await loadConfig(storage)).projects[3]?.tagIds).toBeUndefined();
  });

  it('is a token field: chips stand in the field before the input, there is no add button and the hint is the placeholder', async () => {
    await mount(base(), projectHash('p1'));
    const wrap = field().closest('.q-combobox')!;
    expect(wrap.contains(screen.getByRole('list', { name: 'Assigned tags' }))).toBe(true);
    expect(chips()).toEqual(['Client', 'Draft']);
    expect(wrap.querySelector('ul')!.compareDocumentPosition(field()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add tag' })).toBeNull();
    expect(field().placeholder).toBe('Type a tag and Enter');
    expect(screen.queryByText(/Type a name and press Enter/)).toBeNull();
  });

  it('marks the last chip with Backspace in an empty input and removes it with the second press', async () => {
    const { user } = await mount(base(), projectHash('p1'));
    field().focus();
    await user.keyboard('{Backspace}');
    expect(chips()).toEqual(['Client', 'Draft']);
    const marked = () => document.querySelector('.q-chip[data-marked]')?.textContent;
    expect(marked()).toBe('Draft');
    await user.keyboard('{Backspace}');
    expect(chips()).toEqual(['Client']);
    // Typing resets the mark; Backspace in a filled input only deletes characters.
    await user.keyboard('{Backspace}');
    expect(marked()).toBe('Client');
    await user.keyboard('ab');
    expect(marked()).toBeUndefined();
    await user.keyboard('{Backspace}{Backspace}');
    expect(chips()).toEqual(['Client']);
    expect(field().value).toBe('');
  });

  it('picks a suggestion with the mouse and removes a chip with its icon', async () => {
    const { user } = await mount(base(), projectHash('p4'));
    await user.click(field());
    await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Draft' }));
    expect(chips()).toEqual(['Draft']);
    await user.click(screen.getByRole('button', { name: 'Remove tag Draft' }));
    expect(screen.queryByRole('list', { name: 'Assigned tags' })).toBeNull();
  });

  it('creates and assigns a new tag by typing a name, with the same name rules', async () => {
    const storage = base();
    const { user } = await mount(storage, projectHash('p4'));
    await user.type(field(), 'client x'.slice(0, 6).toUpperCase());
    await user.keyboard('{Enter}');
    expect(screen.getByText('A tag with this name already exists.')).toBeTruthy();
    expect(field().getAttribute('aria-invalid')).toBe('true');
    await user.clear(field());
    await user.type(field(), 'Fresh{Enter}');
    expect(chips()).toEqual(['Fresh']);
    window.location.hash = '#/tags';
    await screen.findByRole('heading', { name: 'Tags', level: 2 });
    expect(rows().at(-1)).toEqual(['Fresh', '1 project']);
    await save(user);
    await screen.findByText('Saved.');
    const config = await loadConfig(storage);
    const fresh = config.tags?.find((x) => x.name === 'Fresh');
    expect(config.projects[3]?.tagIds).toEqual([fresh?.id]);
  });

  it('does not add an already assigned tag twice', async () => {
    const { user } = await mount(base(), projectHash('p1'));
    await user.type(field(), 'Client{Enter}');
    expect(screen.getByText('This tag is already assigned.')).toBeTruthy();
    expect(chips()).toEqual(['Client', 'Draft']);
  });
});

describe('tag filter in the sidebar', () => {
  it('shows projects with at least one chosen tag, hides folders without a hit and opens those with hits', async () => {
    const { user } = await mount(base(), projectHash('p1'));
    expect(folderRows()).toEqual(['Work', 'Misc', 'Empty']);
    await user.click(filterButton('Archive'));
    expect(filterButton('Archive').getAttribute('aria-pressed')).toBe('true');
    expect(visibleNames()).toEqual(['Store']);
    expect(folderRows()).toEqual(['Misc']);
    expect(within(nav()).getByRole('button', { name: /^Misc/ }).getAttribute('aria-expanded')).toBe('true');
    expect(within(nav()).getByText('1 project shown').getAttribute('role')).toBe('status');
    await user.click(filterButton('Client'));
    expect(visibleNames()).toEqual(['Loose', 'Store']);
    expect(within(nav()).getByText('2 projects shown')).toBeTruthy();
    await user.click(filterButton('Draft'));
    expect(visibleNames()).toEqual(['Loose', 'Blog', 'Store']);
    expect(folderRows()).toEqual(['Work', 'Misc']);
    expect(within(nav()).getByRole('button', { name: /^Work/ }).getAttribute('aria-expanded')).toBe('true');
  });

  it('resets to everything and is gone after a reload; nothing is stored', async () => {
    const storage = base();
    const before = JSON.stringify(storage.data);
    const { user, view } = await mount(storage, projectHash('p1'));
    await user.click(filterButton('Archive'));
    expect(within(nav()).getByText('1 project shown')).toBeTruthy();
    await user.click(within(nav()).getByRole('button', { name: 'Reset filter' }));
    expect(within(nav()).queryByText(/ projects? shown$/)).toBeNull();
    // Without a filter the folders are back to their own state: closed, since the open project is not in one.
    expect(visibleNames()).toEqual(['Loose']);
    expect(folderRows()).toEqual(['Work', 'Misc', 'Empty']);
    await user.click(filterButton('Archive'));
    expect(JSON.stringify(storage.data)).toBe(before);
    expect(screen.queryByText('Unsaved')).toBeNull();
    view.unmount();
    await mount(storage, projectHash('p1'));
    expect(within(nav()).queryByText(/ projects? shown$/)).toBeNull();
    expect(filterButton('Archive').getAttribute('aria-pressed')).toBe('false');
    expect(visibleNames()).toEqual(['Loose']);
    expect(folderRows()).toEqual(['Work', 'Misc', 'Empty']);
  });

  it('has no filter without tags', async () => {
    await mount(fakeStorage({ [CONFIG_KEY]: { schemaVersion: 1, projects: [project('p1', 'A')] } }));
    expect(within(nav()).queryByText('Filter by tag')).toBeNull();
  });
});

async function vi_saved() {
  await screen.findAllByText('Saved.');
  await new Promise((r) => setTimeout(r, 0));
}

describe('compact tag filter', () => {
  it('keeps the hint in a tooltip, shows the count only while filtering and matches the visible entries', async () => {
    const { user } = await mount(base(), projectHash('p1'));
    const info = within(nav()).getByRole('button', { name: 'More information' });
    const tip = document.getElementById(info.getAttribute('aria-describedby')!)!;
    expect(tip.hidden).toBe(true);
    await user.hover(info);
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toContain('at least one chosen tag');
    await user.click(filterButton('Client'));
    await user.click(filterButton('Draft'));
    const shown = Number(within(nav()).getByText(/ projects? shown$/).textContent!.split(' ')[0]);
    expect(visibleNames()).toHaveLength(shown);
    const reset = within(nav()).getByRole('button', { name: 'Reset filter' });
    expect(reset.textContent).toBe('');
    await user.click(reset);
    expect(within(nav()).queryByText(/ projects? shown$/)).toBeNull();
  });
});
