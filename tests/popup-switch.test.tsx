// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CONFIG_KEY, type StorageArea } from '../src/config';
import type { ReadTabResult } from '../src/extract/inject';
import { PopupApp, type PopupDeps } from '../src/popup/PopupApp';
import { SETTINGS_KEY, SettingsProvider } from '../src/settings';
import { en } from '../src/i18n/catalog';

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

const config = {
  [CONFIG_KEY]: {
    schemaVersion: 1,
    projects: [
      {
        id: 'a', name: 'a', scope: { allSites: true, domains: [] }, siteMappings: {},
        fields: [{ key: 'title', label: 'Headline', required: false, sources: {} }],
        targets: [{ id: 't', name: 'Hook', url: 'https://hooks.example.com/in', headers: [], purpose: '' }],
      },
    ],
  },
};

const read = async (): Promise<ReadTabResult> => ({
  ok: true,
  result: {
    title: 'Page', url: 'https://example.com/x', content: '', contentFormat: 'markdown', contentTruncated: false,
    jsonLdTypes: [], matchingProjects: [{ id: 'a', name: 'a' }], selectedProjectId: 'a', fields: {},
  } as never,
});

function setup(variant: 'popup' | 'sidepanel', switchApis: PopupDeps['switchApis'], settings: Record<string, unknown> = {}) {
  const settingsStorage = fakeStorage({ [SETTINGS_KEY]: settings });
  const close = vi.fn();
  render(
    <SettingsProvider storage={settingsStorage} subscribe={() => () => undefined} media={media as never} browserLanguage="en-US">
      <PopupApp
        variant={variant}
        storage={fakeStorage(config)}
        draftStorage={fakeStorage()}
        resultStorage={fakeStorage()}
        read={vi.fn(read)}
        getActiveTab={async () => ({ id: 7, url: 'https://example.com/x' })}
        permissions={{ contains: async () => true }}
        connectHighlight={async () => ({ update: () => undefined, close: () => undefined, alive: () => true })}
        close={close}
        switchApis={switchApis}
      />
    </SettingsProvider>,
  );
  return { settingsStorage, close, user: userEvent.setup() };
}

const stored = (s: ReturnType<typeof fakeStorage>) => (s.data[SETTINGS_KEY] as { openAs?: string } | undefined)?.openAs;

describe('switch between popup and side panel in the header', () => {
  it('is absent without a side panel API', async () => {
    setup('popup', {});
    await screen.findByRole('button', { name: en['popup.header.options'] });
    expect(screen.queryByRole('button', { name: en['popup.header.toSidepanel'] })).toBeNull();
  });

  it('popup: named after the target, opens the panel for the tab, stores the choice and closes', async () => {
    const open = vi.fn(async () => undefined);
    const { settingsStorage, close, user } = setup('popup', { sidePanel: { open } });
    const button = await screen.findByRole('button', { name: en['popup.header.toSidepanel'] });
    await user.click(button);
    expect(open).toHaveBeenCalledWith({ tabId: 7 });
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(stored(settingsStorage)).toBe('sidepanel');
  });

  it('popup: a failing open keeps the popup, stores the choice and shows the hint', async () => {
    const { settingsStorage, close, user } = setup('popup', { sidePanel: { open: async () => Promise.reject(new Error('no')) } });
    await user.click(await screen.findByRole('button', { name: en['popup.header.toSidepanel'] }));
    expect((await screen.findByRole('alert')).textContent).toContain(en['popup.switch.failedToSidepanel']);
    expect(stored(settingsStorage)).toBe('sidepanel');
    expect(close).not.toHaveBeenCalled();
  });

  it('side panel: stores popup, sets and opens it, then closes the panel', async () => {
    const calls: string[] = [];
    const apis = {
      action: { setPopup: async () => void calls.push('setPopup'), openPopup: async () => void calls.push('openPopup') },
      sidePanel: { close: async () => void calls.push('close') },
    };
    const { settingsStorage, user } = setup('sidepanel', apis, { openAs: 'sidepanel' });
    await user.click(await screen.findByRole('button', { name: en['popup.header.toPopup'] }));
    await waitFor(() => expect(calls).toEqual(['setPopup', 'openPopup', 'close']));
    expect(stored(settingsStorage)).toBe('popup');
  });

  it('side panel: missing openPopup keeps the panel and shows the hint', async () => {
    const { settingsStorage, close, user } = setup('sidepanel', { sidePanel: {} }, { openAs: 'sidepanel' });
    await user.click(await screen.findByRole('button', { name: en['popup.header.toPopup'] }));
    expect((await screen.findByRole('alert')).textContent).toContain(en['popup.switch.failedToPopup']);
    expect(stored(settingsStorage)).toBe('popup');
    expect(close).not.toHaveBeenCalled();
  });
});
