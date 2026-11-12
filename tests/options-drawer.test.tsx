// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CONFIG_KEY, type StorageArea } from '../src/config';
import { OptionsApp } from '../src/options/OptionsApp';
import { SETTINGS_KEY, SettingsProvider } from '../src/settings';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = '';
});

function fakeStorage(initial: Record<string, unknown>): StorageArea {
  const data = { ...initial };
  return {
    get: async (keys) => Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, structuredClone(data[k])])),
    set: async (items) => void Object.assign(data, structuredClone(items)),
  };
}

const project = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, name, scope: { allSites: true, domains: [] }, fields: [], siteMappings: {}, targets: [], ...extra,
});
const permissions = { contains: async () => false, request: async () => false, remove: async () => true };

async function mount(narrow: boolean, projects: unknown[] = [project('a', 'Alpha'), project('b', 'Beta')], settings: Record<string, unknown> = {}) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: narrow, media: query, addEventListener() {}, removeEventListener() {} }));
  window.location.hash = '#/projects/a';
  const storage = fakeStorage({ [CONFIG_KEY]: { schemaVersion: 1, projects }, [SETTINGS_KEY]: { language: 'en', ...settings } });
  render(
    <SettingsProvider storage={storage} subscribe={() => () => {}} media={{ matches: false, addEventListener() {}, removeEventListener() {} }} browserLanguage="en-US">
      <OptionsApp storage={storage} permissions={permissions} />
    </SettingsProvider>,
  );
  await screen.findByRole('heading', { name: 'Qatlas Clipper', hidden: true });
  await screen.findByLabelText('Project name');
  return userEvent.setup();
}

const menuButton = () => screen.getByRole('button', { name: 'Open navigation' });
const panel = () => document.querySelector<HTMLElement>('.options-nav-slot')!;

describe('navigation drawer', () => {
  it('keeps the sidebar next to the content in wide windows', async () => {
    await mount(false);
    expect(screen.queryByRole('button', { name: 'Open navigation' })).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Options' })).toBeTruthy();
  });

  it('is closed in narrow windows, shows the view title and opens with focus in the panel', async () => {
    const user = await mount(true);
    expect(menuButton().getAttribute('aria-expanded')).toBe('false');
    expect(menuButton().getAttribute('aria-controls')).toBe(panel().id);
    expect(panel().getAttribute('role')).toBe('dialog');
    expect(panel().getAttribute('aria-label')).toBe('Options');
    expect(screen.getByText('Alpha', { selector: '.options-topbar-title' })).toBeTruthy();
    expect(panel().hasAttribute('hidden')).toBe(true);
    expect(screen.queryByRole('navigation', { name: 'Options' })).toBeNull();
    await user.click(menuButton());
    expect(panel().hasAttribute('hidden')).toBe(false);
    expect(menuButton().getAttribute('aria-expanded')).toBe('true');
    expect(within(panel()).getByRole('navigation', { name: 'Options' })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(panel()));
  });

  it('closes on Escape and returns the focus to the button', async () => {
    const user = await mount(true);
    await user.click(menuButton());
    await user.keyboard('{Escape}');
    expect(panel().hasAttribute('hidden')).toBe(true);
    expect(document.activeElement).toBe(menuButton());
  });

  it('closes on a click outside', async () => {
    const user = await mount(true);
    await user.click(menuButton());
    const scrim = document.querySelector('.options-scrim');
    expect(scrim).toBeTruthy();
    await user.click(scrim!);
    expect(panel().hasAttribute('hidden')).toBe(true);
    expect(document.activeElement).toBe(menuButton());
  });

  it('closes when an entry is chosen, also the one already open, and shows the new view', async () => {
    const user = await mount(true);
    await user.click(menuButton());
    await user.click(within(panel()).getByRole('link', { name: 'Beta' }));
    expect(panel().hasAttribute('hidden')).toBe(true);
    expect(document.activeElement).toBe(menuButton());
    await waitFor(() => expect(screen.getByText('Beta', { selector: '.options-topbar-title' })).toBeTruthy());
    await user.click(menuButton());
    await user.click(within(panel()).getByRole('link', { name: 'Beta' }));
    expect(panel().hasAttribute('hidden')).toBe(true);
  });

  it('keeps the focus inside the open panel', async () => {
    const user = await mount(true);
    await user.click(menuButton());
    const items = [...panel().querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled])')];
    const last = items[items.length - 1]!;
    last.focus();
    await user.tab();
    expect(panel().contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(items[0]);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(last);
    // The content behind the panel is inert while it is open.
    expect(screen.getByRole('main', { hidden: true }).hasAttribute('inert')).toBe(true);
  });

  it('leaves the save bar reachable while the drawer is closed', async () => {
    const user = await mount(true);
    await user.type(screen.getByLabelText('Project name'), 'x');
    const save = await screen.findByRole('button', { name: 'Save changes' });
    expect(save.closest('[hidden]')).toBeNull();
    expect(save.closest('[inert]')).toBeNull();
    await user.click(menuButton());
    expect(save.closest('[inert]')).toBeTruthy();
    fireEvent.keyDown(panel(), { key: 'Escape' });
    expect(save.closest('[inert]')).toBeNull();
  });

  it('renders the full address as text for assistive technology', async () => {
    const url = 'https://example.com/hooks/a-very-long-path/that/goes-on-and-on?token=1';
    await mount(false, [project('a', 'Alpha', { targets: [{ id: 't', name: 'Hook', url, headers: [], purpose: '' }] })]);
    const cell = document.querySelector('.options-address')!;
    expect(cell.textContent).toContain(url);
    expect(cell.querySelector('[aria-hidden="true"]')?.textContent).toMatch(/…$/);
  });
});

describe('sidebar collapse', () => {
  const collapse = () => screen.getByRole('button', { name: 'Collapse sidebar' });
  const expand = () => screen.getByRole('button', { name: 'Expand sidebar' });

  it('collapses and expands in wide windows, with aria-expanded and the focus on the opposite button', async () => {
    const user = await mount(false);
    expect(collapse().getAttribute('aria-expanded')).toBe('true');
    expect(collapse().getAttribute('aria-controls')).toBe(panel().id);
    expect(screen.queryByRole('button', { name: 'Expand sidebar' })).toBeNull();
    collapse().focus();
    await user.keyboard('{Enter}');
    expect(panel().hasAttribute('hidden')).toBe(true);
    expect(screen.queryByRole('navigation', { name: 'Options' })).toBeNull();
    expect(expand().getAttribute('aria-expanded')).toBe('false');
    expect(expand().getAttribute('aria-controls')).toBe(panel().id);
    await waitFor(() => expect(document.activeElement).toBe(expand()));
    // The save bar stays reachable while the sidebar is away.
    await user.type(screen.getByLabelText('Project name'), 'x');
    expect(await screen.findByRole('button', { name: 'Save changes' })).toBeTruthy();
    await user.click(expand());
    expect(panel().hasAttribute('hidden')).toBe(false);
    expect(screen.getByRole('navigation', { name: 'Options' })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(collapse()));
  });

  it('starts collapsed when the stored setting says so', async () => {
    await mount(false, undefined, { sidebarCollapsed: true });
    expect(panel().hasAttribute('hidden')).toBe(true);
    expect(expand()).toBeTruthy();
  });

  it('has no effect and no button in narrow windows', async () => {
    const user = await mount(true, undefined, { sidebarCollapsed: true });
    expect(screen.queryByRole('button', { name: 'Collapse sidebar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Expand sidebar' })).toBeNull();
    await user.click(menuButton());
    expect(panel().hasAttribute('hidden')).toBe(false);
    expect(within(panel()).getByRole('navigation', { name: 'Options' })).toBeTruthy();
    expect(within(panel()).queryByRole('button', { name: 'Collapse sidebar' })).toBeNull();
  });
});
