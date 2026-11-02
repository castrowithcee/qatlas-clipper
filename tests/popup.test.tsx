// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CONFIG_KEY, type StorageArea } from '../src/config';
import type { ReadTabResult } from '../src/extract/inject';
import { OPTIONS_FOCUS_KEY } from '../src/options/focus';
import { PopupApp, type PopupDeps } from '../src/popup/PopupApp';
import { LAST_PROJECT_KEY, MAX_DRAFTS, emptyDraft, loadDraft, saveDraft } from '../src/popup/draft';

vi.mock('wxt/browser', () => ({ browser: { storage: { local: {} }, tabs: {}, runtime: {} } }));

afterEach(cleanup);

function fakeStorage(initial: Record<string, unknown> = {}): StorageArea & { data: Record<string, unknown> } {
  const data = { ...initial };
  return {
    data,
    get: async (keys) => Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, structuredClone(data[k])])),
    set: async (items) => void Object.assign(data, structuredClone(items)),
  };
}

const project = (id: string, name: string, fields: unknown[] = [], extra: Record<string, unknown> = {}) => ({
  id, name, scope: { allSites: true, domains: [] }, fields, siteMappings: {}, targets: [{ id: `t-${id}`, name: 'Hook', url: 'https://hooks.example.com/in', headers: [], purpose: '' }], ...extra,
});
const field = (key: string, label: string, extra: Record<string, unknown> = {}) => ({
  key, label, required: false, sources: {}, ...extra,
});
const stored = (...projects: unknown[]) => ({ [CONFIG_KEY]: { schemaVersion: 1, projects } });

const PROJECTS = [
  project('a', 'Alpha', [field('title', 'Headline', { required: true }), field('kind', 'Kind', { sources: { manual: { type: 'choice', values: ['Draft', 'Final'] } } })]),
  project('b', 'Beta', [field('price', 'Price')]),
  project('c', 'Gamma', [field('x', 'Extra')]),
];

type Page = { url: string; title: string; matching: string[]; fields: Record<string, Record<string, { value: string; source: string }>> };

/** Fake reader: fields only for matching projects, like the real one. */
function fakeRead(page: () => Page) {
  return vi.fn(async (_tab: number, _projects: unknown, projectId?: string): Promise<ReadTabResult> => {
    const p = page();
    const selected = projectId === undefined ? p.matching[0] ?? null : p.matching.includes(projectId) ? projectId : null;
    return {
      ok: true,
      result: {
        title: p.title, url: p.url, content: '', contentFormat: 'markdown', contentTruncated: false, jsonLdTypes: [],
        matchingProjects: p.matching.map((id) => ({ id, name: id })),
        selectedProjectId: selected,
        fields: selected ? (p.fields[selected] ?? {}) : {},
      } as never,
    };
  });
}

const basePage = (): Page => ({
  url: 'https://example.com/a', title: 'Article', matching: ['b', 'c'],
  fields: { b: { price: { value: '12', source: 'meta' } }, c: { x: { value: 'v', source: 'schemaOrg' } } },
});

function setup(over: Partial<PopupDeps> & { page?: () => Page; projects?: unknown[] } = {}) {
  const storage = (over.storage ?? fakeStorage(stored(...(over.projects ?? PROJECTS)))) as ReturnType<typeof fakeStorage>;
  const draftStorage = (over.draftStorage ?? fakeStorage()) as ReturnType<typeof fakeStorage>;
  const read = over.read ?? fakeRead(over.page ?? basePage);
  const deps: PopupDeps = {
    storage, draftStorage, read,
    getActiveTab: async () => ({ id: 7, url: (over.page ?? basePage)().url }),
    pick: vi.fn(async () => undefined),
    openOptions: vi.fn(async () => undefined),
    close: vi.fn(),
    ...over,
  };
  const user = userEvent.setup();
  const view = render(<PopupApp {...deps} />);
  return { user, deps, storage, draftStorage, read, view };
}

describe('popup', () => {
  it('shows detected values with source, editable', async () => {
    const { user } = setup();
    const input = await screen.findByLabelText('Price');
    expect(input).toHaveProperty('value', '12');
    expect(screen.getByRole('img', { name: 'Detected automatically' })).toBeTruthy();
    await user.clear(input);
    await user.type(input, '15');
    expect(input).toHaveProperty('value', '15');
    expect(screen.getByRole('img', { name: 'Enter it yourself' })).toBeTruthy();
    expect(screen.getByText('Article')).toBeTruthy();
    expect(screen.getByText('example.com')).toBeTruthy();
  });

  it('orders matching projects first, preselects the first match, all selectable', async () => {
    const { user, read } = setup();
    const select = (await screen.findByLabelText('Project')) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['Beta', 'Gamma', 'Alpha (no match)']);
    expect(select.value).toBe('b');
    await user.selectOptions(select, 'a');
    expect(await screen.findByLabelText('Headline (required)')).toBeTruthy();
    expect(read).toHaveBeenLastCalledWith(7, expect.anything(), 'a');
    // Non-matching project: fields empty, source manual; required marked.
    expect((screen.getByLabelText('Headline (required)') as HTMLInputElement).required).toBe(true);
    expect((screen.getByLabelText('Headline (required)') as HTMLInputElement).value).toBe('');
    expect(screen.getByLabelText('Kind').tagName).toBe('SELECT');
  });

  it('preselects the last chosen project without a match, falls back to the first', async () => {
    const page = () => ({ ...basePage(), matching: [] });
    setup({ page, storage: fakeStorage({ ...stored(...PROJECTS), [LAST_PROJECT_KEY]: 'c' }) });
    expect(((await screen.findByLabelText('Project')) as HTMLSelectElement).value).toBe('c');
    cleanup();
    setup({ page, storage: fakeStorage({ ...stored(...PROJECTS), [LAST_PROJECT_KEY]: 'gone' }) });
    expect(((await screen.findByLabelText('Project')) as HTMLSelectElement).value).toBe('a');
  });

  it('persists the chosen project as last chosen', async () => {
    const { user, storage } = setup();
    await user.selectOptions(await screen.findByLabelText('Project'), 'c');
    await waitFor(() => expect(storage.data[LAST_PROJECT_KEY]).toBe('c'));
  });

  it('keeps edits across remount for the same URL only, and shows fresh values for unedited fields', async () => {
    const draftStorage = fakeStorage();
    let page = basePage();
    page.matching = ['a'];
    page.fields = { a: { title: { value: 'Old', source: 'schemaOrg' }, kind: { value: '', source: 'manual' } } };
    const first = setup({ draftStorage, page: () => page, projects: PROJECTS });
    const title = await screen.findByLabelText(/^Headline/);
    await first.user.clear(title);
    await first.user.type(title, 'Mine');
    await first.user.type(screen.getByLabelText('Note'), 'remember');
    await first.user.selectOptions(screen.getByLabelText('Kind'), 'Final');
    cleanup();

    page = { ...page, fields: { a: { title: { value: 'New', source: 'selector' }, kind: { value: 'Draft', source: 'selector' } } } };
    setup({ draftStorage, page: () => page });
    expect(((await screen.findByLabelText(/^Headline/)) as HTMLInputElement).value).toBe('Mine');
    expect((screen.getByLabelText('Note') as HTMLTextAreaElement).value).toBe('remember');
    expect((screen.getByLabelText('Kind') as HTMLSelectElement).value).toBe('Final');
    cleanup();

    // Unedited field shows the new read value after reopening.
    const other = fakeStorage();
    await saveDraft(other, { ...emptyDraft(page.url), projectId: 'a', note: 'n' });
    setup({ draftStorage: other, page: () => page });
    expect(((await screen.findByLabelText(/^Headline/)) as HTMLInputElement).value).toBe('New');
    cleanup();

    // Another URL does not see the draft.
    const elsewhere = { ...page, url: 'https://example.com/other' };
    setup({ draftStorage, page: () => elsewhere });
    expect(((await screen.findByLabelText(/^Headline/)) as HTMLInputElement).value).toBe('New');
    expect((screen.getByLabelText('Note') as HTMLTextAreaElement).value).toBe('');
  });

  it('keeps line breaks of an edited value in the draft cache', async () => {
    const storage = fakeStorage();
    await saveDraft(storage, { ...emptyDraft('https://example.com/x'), fields: { a: { price: 'one\ntwo\n\nthree' } } });
    expect((await loadDraft(storage, 'https://example.com/x')).fields.a!.price).toBe('one\ntwo\n\nthree');
  });

  it('renders foreign values as literal text', async () => {
    const evil = '<img src=x onerror=alert(1)>';
    const page = () => ({ ...basePage(), title: evil, url: `https://example.com/?q=${evil}`, fields: { b: { price: { value: evil, source: 'meta' } } } });
    const { view } = setup({ page });
    const input = (await screen.findByLabelText('Price')) as HTMLInputElement;
    expect(input.value).toBe(evil);
    expect(screen.getAllByText(evil).length).toBeGreaterThan(0);
    expect(view.container.querySelector('img')).toBeNull();
  });

  it('Map starts the picker and closes the popup; shows an error if it fails', async () => {
    const { user, deps } = setup();
    await screen.findByLabelText('Price');
    await user.click(screen.getByRole('button', { name: 'Click Price on the page' }));
    await waitFor(() => expect(deps.close).toHaveBeenCalledTimes(1));
    expect(deps.pick).toHaveBeenCalledWith(7, 'b', 'price');
    cleanup();

    const failing = setup({ pick: vi.fn(async () => { throw new Error('boom'); }) });
    await screen.findByLabelText('Price');
    await failing.user.click(screen.getByRole('button', { name: 'Click Price on the page' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Starting the picker failed.');
    expect(failing.deps.close).not.toHaveBeenCalled();
  });

  it('shows a hint with options link without projects', async () => {
    const { user, deps } = setup({ projects: [] });
    expect(await screen.findByText('No projects yet')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Create project' }));
    expect(deps.openOptions).toHaveBeenCalled();
  });

  it('hands the selected project to the options page before opening it', async () => {
    const { user, deps, draftStorage } = setup();
    await user.selectOptions(await screen.findByLabelText('Project'), 'a');
    await user.click(screen.getByRole('button', { name: 'Open settings' }));
    await waitFor(() => expect(deps.openOptions).toHaveBeenCalledTimes(1));
    expect(draftStorage.data[OPTIONS_FOCUS_KEY]).toMatchObject({ projectId: 'a' });
  });

  it('opens the options page without a request when writing it fails', async () => {
    const draftStorage = { ...fakeStorage(), set: async () => { throw new Error('no session'); } };
    const { user, deps } = setup({ draftStorage });
    await screen.findByLabelText('Project');
    await user.click(screen.getByRole('button', { name: 'Open settings' }));
    await waitFor(() => expect(deps.openOptions).toHaveBeenCalledTimes(1));
  });

  it('opens the default view without projects', async () => {
    const { user, deps, draftStorage } = setup({ projects: [] });
    await screen.findByText('No projects yet');
    await user.click(screen.getByRole('button', { name: 'Create project' }));
    expect(deps.openOptions).toHaveBeenCalled();
    expect(draftStorage.data).not.toHaveProperty(OPTIONS_FOCUS_KEY);
  });

  it('shows the read error message', async () => {
    const read = vi.fn(async (): Promise<ReadTabResult> => ({ ok: false, kind: 'unsupported', message: 'This page cannot be read.' }));
    setup({ read });
    expect((await screen.findByRole('alert')).textContent).toContain('This page cannot be read');
  });

  it('bounds the draft cache', async () => {
    const s = fakeStorage();
    for (let i = 0; i < MAX_DRAFTS + 5; i++) await saveDraft(s, { ...emptyDraft(`https://example.com/${i}`), note: String(i) });
    expect((await loadDraft(s, 'https://example.com/0')).note).toBe('');
    expect((await loadDraft(s, `https://example.com/${MAX_DRAFTS + 4}`)).note).toBe(String(MAX_DRAFTS + 4));
    expect((s.data.popupDrafts as unknown[]).length).toBe(MAX_DRAFTS);
  });
});
