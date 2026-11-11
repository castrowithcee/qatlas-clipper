// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CONFIG_KEY, HEADER_VALUES_KEY, type StorageArea } from '../src/config';
import { OptionsApp } from '../src/options/OptionsApp';
import { projectHash } from '../src/options/route';
import { shareFilename } from '../src/options/shareFilename';

afterEach(() => {
  cleanup();
  window.location.hash = '';
  vi.unstubAllGlobals();
});

function fakeStorage(initial: Record<string, unknown>): StorageArea {
  const data = { ...initial };
  return {
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
      folders: [{ id: 'f1', name: 'Articles' }, { id: 'f2', name: 'Shop' }],
      projects: [
        project('p1', 'Loose', { targets: [target] }),
        project('p2', 'Blog', { folderId: 'f1', targets: [{ ...target, id: 't2', name: 'Second' }] }),
        project('p3', 'Notes', { folderId: 'f1' }),
        project('p4', 'Store', { folderId: 'f2' }),
      ],
    },
    [HEADER_VALUES_KEY]: { t1: { Authorization: 'secret-token' }, t2: { Authorization: 'other-secret' } },
  });

const permissions = { contains: async () => true, request: async () => true, remove: async () => true };

/** Captures what the save dialog writes. */
function stubSave() {
  const out = { text: '', name: '', close: vi.fn(async () => {}) };
  vi.stubGlobal('showSaveFilePicker', async (o: { suggestedName: string }) => {
    out.name = o.suggestedName;
    return { createWritable: async () => ({ write: async (t: string) => void (out.text = t), close: out.close }) };
  });
  return out;
}

async function mount(storage: StorageArea, hash = '') {
  const user = userEvent.setup();
  window.location.hash = hash;
  render(<OptionsApp storage={storage} permissions={permissions} />);
  await screen.findByRole('navigation', { name: 'Options' });
  return user;
}

const exportOpenProject = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(within(screen.getByRole('main')).getByRole('button', { name: /^Options for project / }));
  await user.click(screen.getByRole('menuitem', { name: 'Export' }));
};
const dialog = () => screen.findByRole('dialog', { name: 'Export selection' });
const done = 'The selection was exported.';

describe('share export of a project', () => {
  it('exports without targets by default and never writes header values', async () => {
    const out = stubSave();
    const user = await mount(storageWith(), projectHash('p1'));
    await exportOpenProject(user);
    const d = await dialog();
    expect(within(d).getByText('Exported: 1 project.')).toBeTruthy();
    const sw = await within(d).findByRole('switch', { name: 'Export targets too' });
    expect((sw as HTMLInputElement).checked).toBe(false);
    await user.click(within(d).getByRole('button', { name: 'Export' }));
    await screen.findByText(done);
    const file = JSON.parse(out.text);
    expect(file).toMatchObject({ format: 'qatlas-clipper-share', targetsIncluded: false });
    expect(file.projects).toHaveLength(1);
    expect(file.projects[0].targets).toEqual([]);
    expect(out.text).not.toContain('secret-token');
    expect(out.name).toBe('qatlas-clipper-loose.json');
  });

  it('asks before exporting targets: cancel keeps them out, confirm includes them, never header values', async () => {
    const out = stubSave();
    const user = await mount(storageWith(), projectHash('p1'));
    await exportOpenProject(user);
    const d = await dialog();
    const sw = await within(d).findByRole('switch', { name: 'Export targets too' });
    await user.click(sw);
    const warn = await screen.findByRole('dialog', { name: 'Export targets too?' });
    expect(within(warn).getByText(/address of 1 target/)).toBeTruthy();
    expect(within(warn).getByText('Access keys are never included.')).toBeTruthy();
    await user.click(within(warn).getByRole('button', { name: 'Cancel' }));
    expect((sw as HTMLInputElement).checked).toBe(false);

    await user.click(sw);
    await user.click(within(await screen.findByRole('dialog', { name: 'Export targets too?' })).getByRole('button', { name: 'Export targets too' }));
    await waitFor(() => expect((sw as HTMLInputElement).checked).toBe(true));
    await user.click(within(d).getByRole('button', { name: 'Export' }));
    await screen.findByText(done);
    const file = JSON.parse(out.text);
    expect(file.targetsIncluded).toBe(true);
    expect(file.projects[0].targets[0].url).toBe('https://example.com/hook');
    expect(out.text).not.toContain('secret-token');
    expect(out.text).not.toContain('other-secret');
  });

  it('has no targets switch when the selection has no targets', async () => {
    const out = stubSave();
    const user = await mount(storageWith(), projectHash('p3'));
    await exportOpenProject(user);
    const d = await dialog();
    await within(d).findByText('Exported: 1 project in 1 folder.');
    expect(within(d).queryByRole('switch')).toBeNull();
    await user.click(within(d).getByRole('button', { name: 'Export' }));
    await screen.findByText(done);
    expect(JSON.parse(out.text).targetsIncluded).toBe(false);
  });

  it('exports the saved state and names unsaved changes', async () => {
    const out = stubSave();
    const user = await mount(storageWith(), projectHash('p3'));
    await user.type(screen.getByLabelText('Project name'), ' changed');
    await exportOpenProject(user);
    const d = await dialog();
    await within(d).findByText('Unsaved changes are not exported.');
    await user.click(within(d).getByRole('button', { name: 'Export' }));
    await screen.findByText(done);
    expect(JSON.parse(out.text).projects[0].name).toBe('Notes');
  });

  it('reports success only after the file is closed and stays silent on cancel', async () => {
    let finish!: () => void;
    const writable = { write: async () => {}, close: vi.fn(() => new Promise<void>((r) => (finish = r))) };
    vi.stubGlobal('showSaveFilePicker', async () => ({ createWritable: async () => writable }));
    const user = await mount(storageWith(), projectHash('p3'));
    await exportOpenProject(user);
    const d = await dialog();
    await user.click(await within(d).findByRole('button', { name: 'Export' }));
    await waitFor(() => expect(writable.close).toHaveBeenCalled());
    expect(screen.queryByText(done)).toBeNull();
    finish();
    await screen.findByText(done);
  });

  it('stays silent when the save dialog is cancelled', async () => {
    const user = await mount(storageWith(), projectHash('p3'));
    vi.stubGlobal('showSaveFilePicker', async () => {
      throw new DOMException('cancelled', 'AbortError');
    });
    await exportOpenProject(user);
    const again = await dialog();
    await user.click(await within(again).findByRole('button', { name: 'Export' }));
    await act(async () => {});
    expect(screen.queryByText(done)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('share export of a folder', () => {
  it('includes all projects of the folder and nothing else', async () => {
    const out = stubSave();
    const user = await mount(storageWith());
    await user.click(screen.getByRole('button', { name: 'Options for folder Articles' }));
    await user.click(screen.getByRole('menuitem', { name: 'Export' }));
    const d = await dialog();
    await within(d).findByText('Exported: 2 projects in 1 folder.');
    await user.click(within(d).getByRole('button', { name: 'Export' }));
    await screen.findByText(done);
    const file = JSON.parse(out.text);
    expect(file.projects.map((p: { id: string }) => p.id)).toEqual(['p2', 'p3']);
    expect(file.folders.map((f: { id: string }) => f.id)).toEqual(['f1']);
    expect(out.name).toBe('qatlas-clipper-articles.json');
  });
});

describe('export manager', () => {
  it('exports exactly the chosen projects with a mixed folder state', async () => {
    const out = stubSave();
    const user = await mount(storageWith(), '#/import-export');
    const tree = await screen.findByRole('list', { name: 'Folders and projects' });
    await user.click(within(tree).getByRole('checkbox', { name: 'Loose' }));
    await user.click(within(tree).getByRole('checkbox', { name: 'Blog' }));
    const articles = within(tree).getByRole('checkbox', { name: 'Articles' }) as HTMLInputElement;
    await waitFor(() => expect(articles.indeterminate).toBe(true));
    expect(articles.checked).toBe(false);
    await user.click(within(tree).getByRole('checkbox', { name: 'Shop' }));
    await user.click(screen.getByRole('button', { name: /^Export selection…/ }));
    const d = await dialog();
    await within(d).findByText('Exported: 3 projects in 2 folders.');
    await user.click(within(d).getByRole('button', { name: 'Export' }));
    await screen.findByText(done);
    const file = JSON.parse(out.text);
    expect(file.projects.map((p: { id: string }) => p.id)).toEqual(['p1', 'p2', 'p4']);
    expect(out.name).toBe('qatlas-clipper-share.json');
  });

  it('a folder selects all its projects; the head checkbox selects all and none and shows mixed', async () => {
    const user = await mount(storageWith(), '#/import-export');
    const tree = await screen.findByRole('list', { name: 'Folders and projects' });
    const head = screen.getByRole('checkbox', { name: 'All projects and folders' }) as HTMLInputElement;
    const exportButton = () => screen.getByRole('button', { name: /^Export selection…/ }) as HTMLButtonElement;
    expect(exportButton().disabled).toBe(true);
    await user.click(within(tree).getByRole('checkbox', { name: 'Articles' }));
    expect((within(tree).getByRole('checkbox', { name: 'Blog' }) as HTMLInputElement).checked).toBe(true);
    expect((within(tree).getByRole('checkbox', { name: 'Notes' }) as HTMLInputElement).checked).toBe(true);
    expect((within(tree).getByRole('checkbox', { name: 'Store' }) as HTMLInputElement).checked).toBe(false);
    await waitFor(() => expect(head.indeterminate).toBe(true));
    expect(head.checked).toBe(false);
    expect(exportButton().textContent).toBe('Export selection… (2)');
    await user.click(head);
    expect(within(tree).getAllByRole('checkbox').every((c) => (c as HTMLInputElement).checked)).toBe(true);
    expect(head.checked).toBe(true);
    expect(head.indeterminate).toBe(false);
    expect(exportButton().textContent).toBe('Export selection… (4)');
    await user.click(head);
    expect(within(tree).getAllByRole('checkbox').every((c) => !(c as HTMLInputElement).checked)).toBe(true);
    expect(exportButton().disabled).toBe(true);
    expect(exportButton().textContent).toBe('Export selection…');
  });

  it('keeps Export disabled after All and clearing every project (no empty export)', async () => {
    const user = await mount(storageWith(), '#/import-export');
    const tree = await screen.findByRole('list', { name: 'Folders and projects' });
    const head = screen.getByRole('checkbox', { name: 'All projects and folders' });
    await user.click(head);
    for (const name of ['Loose', 'Blog', 'Notes', 'Store']) await user.click(within(tree).getByRole('checkbox', { name }));
    expect((screen.getByRole('button', { name: /^Export selection…/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('exports a chosen empty folder on its own', async () => {
    const out = stubSave();
    const storage = fakeStorage({
      [CONFIG_KEY]: { schemaVersion: 1, folders: [{ id: 'f1', name: 'Empty one' }], projects: [project('p1', 'Loose')] },
    });
    const user = await mount(storage, '#/import-export');
    const tree = await screen.findByRole('list', { name: 'Folders and projects' });
    await user.click(within(tree).getByRole('checkbox', { name: 'Empty one' }));
    await user.click(screen.getByRole('button', { name: 'Export selection…' }));
    const d = await dialog();
    await user.click(within(d).getByRole('button', { name: 'Export' }));
    await screen.findByText(done);
    const file = JSON.parse(out.text);
    expect(file.projects).toEqual([]);
    expect(file.folders.map((f: { id: string }) => f.id)).toEqual(['f1']);
  });
});

describe('shareFilename', () => {
  it('is neutral and file-system safe', () => {
    expect(shareFilename('My Blog / 2026: "Draft"?')).toBe('qatlas-clipper-my-blog-2026-draft.json');
    expect(shareFilename('../../etc')).toBe('qatlas-clipper-etc.json');
    expect(shareFilename('***')).toBe('qatlas-clipper-share.json');
    expect(shareFilename(undefined)).toBe('qatlas-clipper-share.json');
    expect(shareFilename('x'.repeat(200)).length).toBeLessThanOrEqual('qatlas-clipper-.json'.length + 40);
  });
});
