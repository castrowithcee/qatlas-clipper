// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CONFIG_KEY, loadConfig, type StorageArea } from '../src/config';
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

async function mount(storage: StorageArea) {
  const user = userEvent.setup();
  render(<OptionsApp storage={storage} />);
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
});
