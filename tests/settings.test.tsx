// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CONFIG_KEY, HEADER_VALUES_KEY, exportConfig, saveConfig, type StorageArea } from '../src/config';
import { SETTINGS_KEY, SettingsProvider, SettingsSection, parseSettings, useI18n, type Settings } from '../src/settings';

vi.mock('wxt/browser', () => ({ browser: { storage: { local: {} } } }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function fakeStorage(initial: Record<string, unknown> = {}): StorageArea & { data: Record<string, unknown> } {
  const data = { ...initial };
  return {
    data,
    get: async (keys) => Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, structuredClone(data[k])])),
    set: async (items) => void Object.assign(data, structuredClone(items)),
  };
}

function fakeMedia(matches: boolean) {
  const listeners = new Set<(e: { matches: boolean }) => void>();
  return {
    matches,
    addEventListener: (_: string, l: (e: { matches: boolean }) => void) => void listeners.add(l),
    removeEventListener: (_: string, l: (e: { matches: boolean }) => void) => void listeners.delete(l),
    set(v: boolean) {
      this.matches = v;
      listeners.forEach((l) => l({ matches: v }));
    },
  };
}

function fakeBus() {
  let listener: ((s: Settings) => void) | undefined;
  return { subscribe: (l: (s: Settings) => void) => ((listener = l), () => (listener = undefined)), emit: (s: Settings) => listener?.(s) };
}

const Probe = () => <p data-testid="probe">{useI18n().t('settings.title')}</p>;

function mount(opts: { stored?: unknown; dark?: boolean; lang?: string; permissions?: { contains: () => Promise<boolean>; request: (o: string[]) => Promise<boolean> } } = {}) {
  const storage = fakeStorage(opts.stored === undefined ? {} : { [SETTINGS_KEY]: opts.stored });
  const media = fakeMedia(opts.dark ?? false);
  const bus = fakeBus();
  const user = userEvent.setup();
  render(
    <SettingsProvider storage={storage} media={media as never} subscribe={bus.subscribe} browserLanguage={opts.lang ?? 'en-US'}>
      <Probe />
      <SettingsSection permissions={opts.permissions ?? { contains: async () => false, request: async () => true }} />
    </SettingsProvider>,
  );
  return { storage, media, bus, user };
}

const theme = () => document.documentElement.dataset.theme;

describe('settings', () => {
  it('falls back to defaults for invalid data', () => {
    expect(parseSettings({ language: 'fr', appearance: 3 })).toEqual({ language: 'auto', appearance: 'system', openAs: 'popup' });
    expect(parseSettings('x')).toEqual({ language: 'auto', appearance: 'system', openAs: 'popup' });
    expect(parseSettings({ language: 'de' })).toEqual({ language: 'de', appearance: 'system', openAs: 'popup' });
  });

  it('auto follows the browser language; a fixed choice wins', async () => {
    mount({ lang: 'de-AT' });
    expect((await screen.findByTestId('probe')).textContent).toBe('Einstellungen');
    cleanup();
    mount({ lang: 'de', stored: { language: 'en' } });
    expect((await screen.findByTestId('probe')).textContent).toBe('Settings');
    cleanup();
    mount({ lang: 'fr' });
    expect((await screen.findByTestId('probe')).textContent).toBe('Settings');
  });

  it('system appearance follows prefers-color-scheme live; a fixed choice wins', async () => {
    const { media } = mount({ dark: true });
    await waitFor(() => expect(theme()).toBe('dark'));
    act(() => media.set(false));
    await waitFor(() => expect(theme()).toBe('light'));
    cleanup();
    const second = mount({ dark: true, stored: { appearance: 'light' } });
    await waitFor(() => expect(theme()).toBe('light'));
    act(() => second.media.set(false));
    expect(theme()).toBe('light');
  });

  it('switches language and appearance without reload and stores them under their own key', async () => {
    const { user, storage } = mount();
    await user.selectOptions(await screen.findByLabelText('Language'), 'de');
    expect(screen.getByTestId('probe').textContent).toBe('Einstellungen');
    expect(document.documentElement.lang).toBe('de');
    await user.click(screen.getByRole('radio', { name: 'Dunkel' }));
    expect(theme()).toBe('dark');
    expect(storage.data[SETTINGS_KEY]).toEqual({ language: 'de', appearance: 'dark', openAs: 'popup' });
  });

  it('reacts to a change made in another context', async () => {
    const { bus } = mount();
    await screen.findByTestId('probe');
    act(() => bus.emit({ language: 'de', appearance: 'dark', openAs: 'popup' }));
    expect(screen.getByTestId('probe').textContent).toBe('Einstellungen');
    expect(theme()).toBe('dark');
  });

  it('is not part of the exported configuration', async () => {
    const storage = fakeStorage({ [SETTINGS_KEY]: { language: 'de', appearance: 'dark', openAs: 'sidepanel' } });
    await saveConfig({ schemaVersion: 1, projects: [] }, storage);
    const text = await exportConfig(storage);
    expect(text).not.toMatch(/language|appearance|openAs|settings/);
    expect(JSON.parse(text)).toEqual({ schemaVersion: 1, projects: [] });
    expect(SETTINGS_KEY).not.toBe(CONFIG_KEY);
    expect(SETTINGS_KEY).not.toBe(HEADER_VALUES_KEY);
  });
});

describe('open as setting', () => {
  it('is hidden without chrome.sidePanel', async () => {
    vi.stubGlobal('chrome', {});
    mount();
    await screen.findByTestId('probe');
    expect(screen.queryByRole('radio', { name: 'Side panel' })).toBeNull();
    expect(screen.queryByText('Open as')).toBeNull();
  });

  const ALL = ['https://*/*', 'http://*/*'];
  const perms = (contains: boolean, request: boolean) => ({
    contains: vi.fn(async () => contains),
    request: vi.fn(async () => request),
  });

  it('requests the two origins synchronously in the click; granted saves the side panel', async () => {
    vi.stubGlobal('chrome', { sidePanel: {} });
    const permissions = perms(false, true);
    const { storage } = mount({ permissions });
    expect(((await screen.findByRole('radio', { name: 'Popup' })) as HTMLInputElement).checked).toBe(true);
    await waitFor(() => expect(permissions.contains).toHaveBeenCalled());
    screen.getByRole('radio', { name: 'Side panel' }).click();
    expect(permissions.request).toHaveBeenCalledTimes(1);
    expect(permissions.request).toHaveBeenCalledWith(ALL);
    await waitFor(() => expect(storage.data[SETTINGS_KEY]).toEqual({ language: 'auto', appearance: 'system', openAs: 'sidepanel' }));
  });

  it('keeps the popup and explains when the request is declined', async () => {
    vi.stubGlobal('chrome', { sidePanel: {} });
    const { user, storage } = mount({ permissions: perms(false, false) });
    await user.click(await screen.findByRole('radio', { name: 'Side panel' }));
    expect((await screen.findByRole('alert')).textContent).toContain('needs access to all websites');
    expect(storage.data[SETTINGS_KEY]).toBeUndefined();
    expect(((await screen.findByRole('radio', { name: 'Popup' })) as HTMLInputElement).checked).toBe(true);
  });

  it('keeps the popup when the request throws', async () => {
    vi.stubGlobal('chrome', { sidePanel: {} });
    const permissions = { contains: async () => false, request: () => { throw new Error('no gesture'); } };
    const { user, storage } = mount({ permissions });
    await user.click(await screen.findByRole('radio', { name: 'Side panel' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(storage.data[SETTINGS_KEY]).toBeUndefined();
  });

  it('switches without a request when the access is already granted', async () => {
    vi.stubGlobal('chrome', { sidePanel: {} });
    const permissions = perms(true, true);
    const { user, storage } = mount({ permissions });
    await screen.findByRole('radio', { name: 'Side panel' });
    await waitFor(() => expect(permissions.contains).toHaveBeenCalled());
    await user.click(screen.getByRole('radio', { name: 'Side panel' }));
    await waitFor(() => expect((storage.data[SETTINGS_KEY] as Settings).openAs).toBe('sidepanel'));
    expect(permissions.request).not.toHaveBeenCalled();
  });

  it('never requests when popup is selected', async () => {
    vi.stubGlobal('chrome', { sidePanel: {} });
    const permissions = perms(false, true);
    const { user, storage } = mount({ stored: { language: 'auto', appearance: 'system', openAs: 'sidepanel' }, permissions });
    await user.click(await screen.findByRole('radio', { name: 'Popup' }));
    await waitFor(() => expect((storage.data[SETTINGS_KEY] as Settings).openAs).toBe('popup'));
    expect(permissions.request).not.toHaveBeenCalled();
  });

  it('falls back to popup for invalid values', () => {
    expect(parseSettings({ openAs: 'window' }).openAs).toBe('popup');
  });
});
