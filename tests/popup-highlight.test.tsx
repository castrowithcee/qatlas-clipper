// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CONFIG_KEY, type StorageArea } from '../src/config';
import type { ReadTabResult } from '../src/extract/inject';
import type { HighlightConnection } from '../src/highlight/connect';
import { PopupApp } from '../src/popup/PopupApp';
import { SETTINGS_KEY, SettingsProvider } from '../src/settings';
import { en } from '../src/i18n/catalog';
import { chooseProject } from './helpers/projectChoice';

vi.mock('wxt/browser', () => ({ browser: { storage: { local: {} }, tabs: {}, runtime: {} } }));

afterEach(cleanup);

const media = { matches: false, addEventListener: () => undefined, removeEventListener: () => undefined };

function fakeStorage(initial: Record<string, unknown> = {}): StorageArea & { data: Record<string, unknown> } {
  const data = { ...initial };
  return {
    data,
    get: async (keys) => Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, structuredClone(data[k])])),
    set: async (items) => void Object.assign(data, structuredClone(items)),
  };
}

const field = (key: string, label: string) => ({ key, label, required: false, sources: {} });
const project = (id: string, mappings: Record<string, Record<string, string>>) => ({
  id,
  name: id,
  scope: { allSites: true, domains: [] },
  fields: [field('title', 'Headline'), field('price', 'Price')],
  siteMappings: mappings,
  targets: [{ id: `t-${id}`, name: 'Hook', url: 'https://hooks.example.com/in', headers: [], purpose: '' }],
});
const cfg = (...projects: unknown[]) => ({ [CONFIG_KEY]: { schemaVersion: 1, projects } });

const readOf = (url: string, selected = 'a'): ReadTabResult => ({
  ok: true,
  result: {
    title: 'Page', url, content: '', contentFormat: 'markdown', contentTruncated: false, jsonLdTypes: [],
    matchingProjects: [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }], selectedProjectId: selected, fields: {},
  } as never,
});

function fakeConnect() {
  const conns: { update: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; dead: boolean; tabId: number }[] = [];
  const connect = vi.fn(async (tabId: number): Promise<HighlightConnection> => {
    const c = { update: vi.fn(), close: vi.fn(() => void (c.dead = true)), dead: false, tabId };
    conns.push(c);
    return { update: c.update, close: c.close, alive: () => !c.dead };
  });
  return { conns, connect };
}

function setup(over: { config?: Record<string, unknown>; settings?: Record<string, unknown>; url?: string; connect?: ReturnType<typeof fakeConnect>['connect'] } = {}) {
  const { connect = fakeConnect().connect } = over;
  const storage = fakeStorage(over.config ?? cfg(project('a', { 'example.com': { title: 'h1' } }), project('b', { 'example.com': { price: '.p' } })));
  const props = {
    storage,
    draftStorage: fakeStorage(),
    resultStorage: fakeStorage(),
    read: vi.fn(async (_t: number, _p: unknown, id?: string) => readOf(over.url ?? 'https://example.com/x', id ?? 'a')),
    getActiveTab: async () => ({ id: 7, url: over.url ?? 'https://example.com/x' }),
    permissions: { contains: vi.fn(async () => true) },
    close: vi.fn(),
    connectHighlight: connect,
  };
  const settings = fakeStorage(over.settings ? { [SETTINGS_KEY]: over.settings } : {});
  const ui = (p: typeof props) => (
    <SettingsProvider storage={settings} subscribe={() => () => undefined} media={media as never} browserLanguage="en-US">
      <PopupApp {...p} />
    </SettingsProvider>
  );
  const view = render(ui(props));
  return { view, props, storage, settings, ui, user: userEvent.setup() };
}

describe('highlight connection of the popup and side panel', () => {
  it('sends label and selector of the mapped fields for this website only', async () => {
    const { conns, connect } = fakeConnect();
    setup({ connect });
    await waitFor(() => expect(conns[0]?.update).toHaveBeenCalledWith([{ label: 'Headline', selector: 'h1' }]));
    expect(connect).toHaveBeenCalledWith(7);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('does not touch the page without mapping for this website', async () => {
    const { conns, connect } = fakeConnect();
    setup({ connect, url: 'https://example.net/x' });
    await screen.findByRole('button', { name: en['popup.header.highlight'] });
    expect(conns).toHaveLength(0);
  });

  it('updates on project change', async () => {
    const { conns, connect } = fakeConnect();
    const { user } = setup({ connect });
    await waitFor(() => expect(conns[0]?.update).toHaveBeenCalled());
    await chooseProject(user, 'b');
    await waitFor(() => expect(conns[0]!.update).toHaveBeenLastCalledWith([{ label: 'Price', selector: '.p' }]));
    expect(conns).toHaveLength(1);
  });

  it('closes the connection on unmount', async () => {
    const { conns, connect } = fakeConnect();
    const { view } = setup({ connect });
    await waitFor(() => expect(conns[0]?.update).toHaveBeenCalled());
    view.unmount();
    await waitFor(() => expect(conns[0]!.close).toHaveBeenCalled());
  });

  it('closes on switch off and connects again on switch on', async () => {
    const { conns, connect } = fakeConnect();
    const { user, settings } = setup({ connect });
    await waitFor(() => expect(conns[0]?.update).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: en['popup.header.highlight'] }));
    await waitFor(() => expect(conns[0]!.close).toHaveBeenCalled());
    expect((settings.data[SETTINGS_KEY] as { highlight: boolean }).highlight).toBe(false);
    await user.click(screen.getByRole('button', { name: en['popup.header.highlight'] }));
    await waitFor(() => expect(conns[1]?.update).toHaveBeenCalledWith([{ label: 'Headline', selector: 'h1' }]));
  });

  it('never connects while the setting is off', async () => {
    const { conns, connect } = fakeConnect();
    setup({ connect, settings: { highlight: false } });
    await screen.findByRole('button', { name: en['popup.header.highlight'] });
    expect(conns).toHaveLength(0);
  });

  it('survives a failing connect without a frame or an error', async () => {
    const connect = vi.fn(async () => {
      throw new Error('no access');
    });
    setup({ connect });
    await waitFor(() => expect(connect).toHaveBeenCalled());
    expect(await screen.findByRole('button', { name: en['popup.header.highlight'] })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reconnects when the port ended (page navigated) and the panel read again', async () => {
    const { conns, connect } = fakeConnect();
    const { view, props, ui } = setup({ connect });
    await waitFor(() => expect(conns[0]?.update).toHaveBeenCalled());
    conns[0]!.dead = true;
    view.rerender(ui({ ...props, reloadToken: 1 } as never));
    await waitFor(() => expect(conns[1]?.update).toHaveBeenCalledWith([{ label: 'Headline', selector: 'h1' }]));
  });

  it('sends the emptied list when a mapping is removed', async () => {
    const { conns, connect } = fakeConnect();
    const { view, props, ui, storage } = setup({ connect });
    await waitFor(() => expect(conns[0]?.update).toHaveBeenCalled());
    (storage.data[CONFIG_KEY] as { projects: { siteMappings: unknown }[] }).projects[0]!.siteMappings = {};
    view.rerender(ui({ ...props, reloadToken: 1 } as never));
    await waitFor(() => expect(conns[0]!.update).toHaveBeenLastCalledWith([]));
  });
});
