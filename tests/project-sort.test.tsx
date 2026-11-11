// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CONFIG_KEY, buildShare, exportConfig, loadConfig, stringifyShare, sortByLabel, type StorageArea } from '../src/config';
import { OptionsApp } from '../src/options/OptionsApp';
import { ShareManager } from '../src/options/ShareManager';
import { Header } from '../src/popup/Header';
import { orderProjects, pickProject } from '../src/popup/draft';
import { SETTINGS_KEY, SettingsProvider } from '../src/settings';

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

const media = { matches: false, addEventListener() {}, removeEventListener() {} };
const project = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, name, scope: { allSites: true, domains: [] }, fields: [], siteMappings: {}, targets: [], ...extra,
});
// Manual order is deliberately not alphabetical; the umlaut and the lower-case name test the collation.
const FOLDERS = [{ id: 'f1', name: 'Zeta' }, { id: 'f2', name: 'alpha' }];
const PROJECTS = [
  project('p1', 'Mango'),
  project('p2', 'Zebra', { folderId: 'f1' }),
  project('p3', 'Äpfel', { folderId: 'f1' }),
  project('p4', 'apfel', { folderId: 'f1' }),
  project('p5', 'banane'),
  project('p6', 'Kiwi', { folderId: 'f2' }),
];
const stored = (sort?: string) => ({
  [CONFIG_KEY]: { schemaVersion: 1, folders: FOLDERS, projects: PROJECTS },
  [SETTINGS_KEY]: { language: 'en', ...(sort ? { projectSort: sort } : {}) },
});

describe('sortByLabel', () => {
  it('keeps manual order, sorts by language without case, and keeps ties in given order', () => {
    const items = ['b', 'Ä', 'a', 'B', 'A'];
    expect(sortByLabel(items, 'manual', 'de', (x) => x)).toEqual(items);
    expect(sortByLabel(items, 'nameAsc', 'de', (x) => x)).toEqual(['a', 'A', 'Ä', 'b', 'B']);
    expect(sortByLabel(items, 'nameDesc', 'de', (x) => x)).toEqual(['b', 'B', 'Ä', 'a', 'A']);
    // The input is never changed.
    expect(items).toEqual(['b', 'Ä', 'a', 'B', 'A']);
    // The language decides where the umlaut goes.
    expect(sortByLabel(['Zebra', 'Äpfel', 'Apfel', 'Banane'], 'nameAsc', 'de', (x) => x)).toEqual(['Apfel', 'Äpfel', 'Banane', 'Zebra']);
    expect(sortByLabel(['Zebra', 'Äpfel', 'Apfel', 'Banane'], 'nameAsc', 'sv', (x) => x)).toEqual(['Apfel', 'Banane', 'Zebra', 'Äpfel']);
  });
});

async function mountOptions(sort?: string, hash = '') {
  const storage = fakeStorage(stored(sort));
  window.location.hash = hash;
  render(
    <SettingsProvider storage={storage} subscribe={() => () => {}} media={media} browserLanguage="en-US">
      <OptionsApp storage={storage} />
    </SettingsProvider>,
  );
  const nav = await screen.findByRole('navigation', { name: 'Options' });
  return { storage, nav, user: userEvent.setup() };
}

const rowNames = (nav: HTMLElement) =>
  Array.from(within(nav).getByRole('list', { name: 'Projects' }).children).map((li) =>
    li.classList.contains('options-folder')
      ? `[${li.querySelector('.options-folder-name')?.textContent}] ${Array.from(li.querySelectorAll('.options-folder-projects a')).map((a) => a.textContent).join(',')}`
      : li.querySelector('a')?.textContent,
  );

describe('sidebar sort', () => {
  it('shows the manual order by default and sorts per group and folders for A–Z and Z–A, loose projects first', async () => {
    const { nav } = await mountOptions();
    expect(rowNames(nav)).toEqual(['Mango', 'banane', '[Zeta] Zebra,Äpfel,apfel', '[alpha] Kiwi']);
    cleanup();
    const asc = await mountOptions('nameAsc');
    expect(rowNames(asc.nav)).toEqual(['banane', 'Mango', '[alpha] Kiwi', '[Zeta] apfel,Äpfel,Zebra']);
    cleanup();
    const desc = await mountOptions('nameDesc');
    expect(rowNames(desc.nav)).toEqual(['Mango', 'banane', '[Zeta] Zebra,Äpfel,apfel', '[alpha] Kiwi']);
  });

  it('offers the sort as a radio group with icons in the title menu and stores the choice as device setting only', async () => {
    const { nav, user, storage } = await mountOptions();
    await user.click(within(nav).getByRole('button', { name: 'Options for projects' }));
    const group = screen.getByRole('group', { name: 'Sort order' });
    expect(within(group).getAllByRole('menuitemradio').map((r) => r.textContent)).toEqual(['Manual', 'A–Z', 'Z–A']);
    expect(within(group).getAllByRole('menuitemradio').every((r) => r.querySelector('svg'))).toBe(true);
    expect(within(group).getByRole('menuitemradio', { name: 'Manual' }).getAttribute('aria-checked')).toBe('true');
    await user.click(within(group).getByRole('menuitemradio', { name: 'A–Z' }));
    await waitFor(() => expect(rowNames(nav)[0]).toBe('banane'));
    expect((storage.data[SETTINGS_KEY] as { projectSort: string }).projectSort).toBe('nameAsc');
    // The stored configuration keeps the manual order and does not change.
    expect(((storage.data[CONFIG_KEY] as { projects: { id: string }[] }).projects).map((p) => p.id)).toEqual(PROJECTS.map((p) => p.id));
    expect(JSON.stringify(storage.data[CONFIG_KEY])).not.toMatch(/projectSort|nameAsc/);
  });

  it('disables reordering in the menus with a reason while keeping Move to folder working', async () => {
    const { nav, user, storage } = await mountOptions('nameAsc');
    await user.click(within(nav).getByRole('button', { name: 'Options for project Mango' }));
    for (const name of ['Move up', 'Move down']) {
      const item = screen.getByRole('menuitem', { name });
      expect(item.getAttribute('aria-disabled')).toBe('true');
      expect(item.getAttribute('title')).toMatch(/alphabetically/);
    }
    await user.click(screen.getByRole('menuitemradio', { name: 'alpha' }));
    await waitFor(() => expect(rowNames(nav)).toEqual(['banane', '[alpha] Kiwi,Mango', '[Zeta] apfel,Äpfel,Zebra']));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(async () => expect((await loadConfig(storage)).projects.find((p) => p.id === 'p1')?.folderId).toBe('f2'));
    // Only the group changed: the manual order of everything else is as before.
    expect((await loadConfig(storage)).projects.map((p) => p.id).filter((id) => id !== 'p1')).toEqual(['p2', 'p3', 'p4', 'p5', 'p6']);
  });

  it('disables Move up and Move down of a folder when sorted and keeps them when manual', async () => {
    const sorted = await mountOptions('nameAsc');
    await sorted.user.click(within(sorted.nav).getByRole('button', { name: 'Options for folder Zeta' }));
    expect(screen.getByRole('menuitem', { name: 'Move up' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('menuitem', { name: 'Move down' }).getAttribute('aria-disabled')).toBe('true');
    expect(within(sorted.nav).queryByRole('button', { name: /^Move folder/ })).toBeNull();
    cleanup();
    const manual = await mountOptions();
    await manual.user.click(within(manual.nav).getByRole('button', { name: 'Options for folder Zeta' }));
    expect(screen.getByRole('menuitem', { name: 'Move down' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('ignores arrow keys at a project grip when sorted and moves when manual', async () => {
    const sorted = await mountOptions('nameAsc');
    const grip = within(sorted.nav).getByRole('button', { name: 'Move project Mango' });
    grip.focus();
    await sorted.user.keyboard('{ArrowUp}');
    expect(rowNames(sorted.nav)).toEqual(['banane', 'Mango', '[alpha] Kiwi', '[Zeta] apfel,Äpfel,Zebra']);
    cleanup();
    const manual = await mountOptions();
    within(manual.nav).getByRole('button', { name: 'Move project banane' }).focus();
    await manual.user.keyboard('{ArrowUp}');
    expect(rowNames(manual.nav)[0]).toBe('banane');
  });

  it('shows the project menu at the project title sorted too, without reorder entries enabled', async () => {
    const { user } = await mountOptions('nameAsc', '#/project/p1');
    const heading = await screen.findByRole('heading', { level: 2 });
    const header = heading.closest('header') ?? heading.parentElement!;
    await user.click(within(header).getByRole('button', { name: /^Options for project/ }));
    expect(screen.getByRole('menuitem', { name: 'Move up' }).getAttribute('aria-disabled')).toBe('true');
  });
});

describe('export files stay unchanged', () => {
  it('writes no device value and the manual order into the backup and the share file', async () => {
    const storage = fakeStorage(stored('nameDesc'));
    const backup = await exportConfig(storage);
    expect(backup).not.toMatch(/projectSort|nameDesc/);
    expect(JSON.parse(backup).projects.map((p: { id: string }) => p.id)).toEqual(PROJECTS.map((p) => p.id));
    const share = stringifyShare(buildShare(await loadConfig(storage), { projectIds: ['p1', 'p2', 'p5'], folderIds: [], includeTargets: false }));
    expect(share).not.toMatch(/projectSort|nameDesc/);
    expect(JSON.parse(share).projects.map((p: { id: string }) => p.id)).toEqual(['p1', 'p2', 'p5']);
  });
});

describe('project choice when capturing', () => {
  const projects = PROJECTS.map((p) => ({ id: p.id, name: p.name, folderId: (p as { folderId?: string }).folderId }));
  const options = async (sort: string, matching: string[], lang = 'en') => {
    const storage = fakeStorage({ [SETTINGS_KEY]: { language: lang, projectSort: sort } });
    const user = userEvent.setup();
    render(
      <SettingsProvider storage={storage} subscribe={() => () => {}} media={media} browserLanguage="en-US">
        <Header projects={orderProjects(projects, matching)} folders={FOLDERS} matchingIds={matching} value="p1" onChange={() => {}} onOpenOptions={() => {}} highlight onToggleHighlight={() => {}} />
      </SettingsProvider>,
    );
    await user.click(await screen.findByRole('combobox', { name: 'Project' }));
    return within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent);
  };

  it('keeps the manual order by default', async () => {
    expect(await options('manual', [])).toEqual(['Mango', 'banane', 'Zebra', 'Äpfel', 'apfel', 'Kiwi']);
  });

  it('sorts matching projects on top and every other group in itself', async () => {
    expect(await options('nameAsc', ['p6', 'p1'])).toEqual(['Kiwi', 'Mango', 'banane', 'apfel', 'Äpfel', 'Zebra']);
  });

  it('sorts Z–A', async () => {
    expect(await options('nameDesc', [])).toEqual(['Mango', 'banane', 'Zebra', 'Äpfel', 'apfel', 'Kiwi']);
  });

  it('keeps the preselection on the first matching project of the manual order', () => {
    expect(pickProject(projects, ['p5', 'p1'], undefined, undefined)).toBe('p5');
  });
});

describe('export manager', () => {
  it('lists folders and projects sorted while the export keeps the stored order', async () => {
    const storage = fakeStorage(stored('nameAsc'));
    const user = userEvent.setup();
    render(
      <SettingsProvider storage={storage} subscribe={() => () => {}} media={media} browserLanguage="en-US">
        <ShareManager storage={storage} dirty={false} />
      </SettingsProvider>,
    );
    const tree = await screen.findByRole('list', { name: /./ });
    const top = Array.from(tree.children).map((li) => li.querySelector('label')?.textContent);
    expect(top).toEqual(['banane', 'Mango', 'alpha', 'Zeta']);
    const zeta = within(tree).getAllByTestId('share-folder')[1]!;
    expect(Array.from(zeta.querySelectorAll('ul label')).map((l) => l.textContent)).toEqual(['apfel', 'Äpfel', 'Zebra']);
    await user.click(within(zeta).getAllByRole('checkbox')[0]!);
    expect(within(zeta).getAllByRole('checkbox').every((c) => (c as HTMLInputElement).checked)).toBe(true);
  });
});
