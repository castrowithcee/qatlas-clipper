// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CONFIG_KEY, type StorageArea } from '../src/config';
import type { ReadTabResult } from '../src/extract/inject';
import { PopupApp, type PopupDeps } from '../src/popup/PopupApp';

vi.mock('wxt/browser', () => ({ browser: { storage: { local: {} }, tabs: {}, runtime: {} } }));

afterEach(cleanup);

function fakeStorage(initial: Record<string, unknown> = {}): StorageArea {
  const data = { ...initial };
  return {
    get: async (keys) => Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, structuredClone(data[k])])),
    set: async (items) => void Object.assign(data, structuredClone(items)),
  };
}

const config = {
  schemaVersion: 1,
  projects: [{ id: 'a', name: 'Alpha', scope: { allSites: true, domains: [] }, fields: [{ key: 'p', label: 'Price', required: false, sources: {} }], siteMappings: {}, targets: [{ id: 't', name: 'Hook', url: 'https://hooks.example.com/in', headers: [], purpose: '' }] }],
};
const noAccess: ReadTabResult = { ok: false, kind: 'no-access', message: 'x' };
const ready: ReadTabResult = {
  ok: true,
  result: {
    title: 'Article', url: 'https://shop.example.com/a', content: '', contentFormat: 'markdown', contentTruncated: false, jsonLdTypes: [],
    matchingProjects: [{ id: 'a', name: 'a' }], selectedProjectId: 'a', fields: {},
  } as never,
};

function setup(over: Partial<PopupDeps>, reads: ReadTabResult[]) {
  const read = vi.fn(async () => reads[Math.min(read.mock.calls.length - 1, reads.length - 1)]!);
  const deps: PopupDeps = {
    storage: fakeStorage({ [CONFIG_KEY]: config }),
    draftStorage: fakeStorage(),
    resultStorage: fakeStorage(),
    read,
    getActiveTab: async () => ({ id: 7, url: 'https://shop.example.com/a?x=1' }),
    close: vi.fn(),
    variant: 'sidepanel',
    ...over,
  };
  render(<PopupApp {...deps} />);
  return { read, user: userEvent.setup() };
}

const ALL = ['https://*/*', 'http://*/*'];

describe('side panel site access', () => {
  it('requests the two all-websites origins on click and reads again after the grant', async () => {
    const requestOrigins = vi.fn(async () => true);
    const { read, user } = setup({ requestOrigins, permissions: { contains: async () => false } }, [noAccess, ready]);
    await user.click(await screen.findByRole('button', { name: 'Allow reading all websites' }));
    expect(requestOrigins).toHaveBeenCalledTimes(1);
    expect(requestOrigins).toHaveBeenCalledWith(ALL);
    expect(await screen.findByLabelText('Price')).toBeTruthy();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('calls the request synchronously within the click', async () => {
    const requestOrigins = vi.fn(() => Promise.resolve(false));
    setup({ requestOrigins, permissions: { contains: async () => false } }, [noAccess]);
    (await screen.findByRole('button', { name: 'Allow reading all websites' })).click();
    expect(requestOrigins).toHaveBeenCalledTimes(1);
  });

  it('explains a denied request and keeps the button', async () => {
    const { user, read } = setup({ requestOrigins: async () => false, permissions: { contains: async () => false } }, [noAccess]);
    await user.click(await screen.findByRole('button', { name: 'Allow reading all websites' }));
    expect(await screen.findByText(/Not allowed/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Allow reading all websites' })).toBeTruthy();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('mentions the toolbar button and offers no retry without the permission', async () => {
    setup({ permissions: { contains: async () => false } }, [noAccess]);
    expect(await screen.findByText(/click on the extension icon/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('says the browser blocks the page, without a button, when the permission is present', async () => {
    const requestOrigins = vi.fn(async () => true);
    setup({ requestOrigins, permissions: { contains: async () => true } }, [noAccess]);
    expect(await screen.findByText('The browser does not allow reading this page.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(requestOrigins).not.toHaveBeenCalled();
  });

  it('keeps the popup behavior unchanged', async () => {
    setup({ variant: 'popup' }, [noAccess]);
    expect(await screen.findByText('Open the extension from the page you want to read.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Allow reading all websites' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('keeps typed text when the panel reads the tab again', async () => {
    const read = vi.fn(async () => ready);
    const deps: PopupDeps = { storage: fakeStorage({ [CONFIG_KEY]: config }), draftStorage: fakeStorage(), resultStorage: fakeStorage(), read, getActiveTab: async () => ({ id: 7, url: 'https://shop.example.com/a' }), variant: 'sidepanel' };
    const view = render(<PopupApp {...deps} />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Price'), '42');
    const before = read.mock.calls.length;
    view.rerender(<PopupApp {...deps} reloadToken={1} />);
    await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(before));
    expect((await screen.findByLabelText('Price') as HTMLInputElement).value).toBe('42');
  });
});
