// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CONFIG_KEY, type StorageArea } from '../src/config';
import type { ReadTabResult } from '../src/extract/inject';
import { DETECT_VALUES } from '../src/extract/detect';
import { PopupApp, type PopupDeps } from '../src/popup/PopupApp';
import { RESULTS_KEY } from '../src/send/results';
import { SettingsProvider } from '../src/settings';
import { de, en } from '../src/i18n/catalog';

vi.mock('wxt/browser', () => ({ browser: { storage: { local: {} }, tabs: {}, runtime: {} } }));

afterEach(cleanup);

const URL_A = 'https://example.com/a';
const media = { matches: false, addEventListener: () => undefined, removeEventListener: () => undefined };

function fakeStorage(initial: Record<string, unknown> = {}): StorageArea & { data: Record<string, unknown> } {
  const data = { ...initial };
  return {
    data,
    get: async (keys) => Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, structuredClone(data[k])])),
    set: async (items) => void Object.assign(data, structuredClone(items)),
  };
}

const target = { id: 't1', name: 'Hook', url: 'https://hooks.example.com/in', headers: [], purpose: '' };
const FIELDS = [
  { key: 'title', label: 'Headline', required: true, sources: { detect: 'title' } },
  { key: 'author', label: 'Author', required: false, sources: { schemaOrgPath: 'Article.author.name' } },
  { key: 'price', label: 'Price', required: false, sources: { metaTag: { attribute: 'name', name: 'price' } } },
  { key: 'size', label: 'Size', required: false, sources: {} },
  { key: 'note', label: 'Free', required: false, sources: {} },
];
const config = (targets: unknown[] = [target], projects = 1) => ({
  [CONFIG_KEY]: {
    schemaVersion: 1,
    projects: Array.from({ length: projects }, (_, i) => ({
      id: `p${i}`, name: `Alpha${i}`, scope: { allSites: true, domains: [] }, siteMappings: {}, fields: FIELDS,
      targets: targets.map((t) => ({ ...(t as object), id: `${(t as { id: string }).id}-${i}` })),
    })),
  },
});

const found = {
  title: { value: 'Read title', source: 'detect' },
  author: { value: 'Jane', source: 'schemaOrg' },
  price: { value: '9', source: 'meta' },
  size: { value: 'L', source: 'selector' },
};

const okRead = async (): Promise<ReadTabResult> => ({
  ok: true,
  result: {
    title: 'Article', url: URL_A, contentMarkdown: '', contentTruncated: false, jsonLdTypes: [],
    matchingProjects: [{ id: 'p0', name: 'Alpha0' }], selectedProjectId: 'p0', fields: found,
  } as never,
});

function setup(lang: 'de' | 'en', over: Partial<PopupDeps> & { cfg?: unknown } = {}) {
  const deps: PopupDeps = {
    storage: fakeStorage((over.cfg as Record<string, unknown>) ?? config()),
    draftStorage: fakeStorage(),
    resultStorage: fakeStorage(),
    read: okRead,
    getActiveTab: async () => ({ id: 7, url: URL_A }),
    pick: vi.fn(async () => undefined),
    openOptions: vi.fn(async () => undefined),
    close: vi.fn(),
    permissions: { contains: vi.fn(async () => true) },
    ...over,
  };
  const user = userEvent.setup();
  const view = render(
    <SettingsProvider storage={fakeStorage()} subscribe={() => () => undefined} media={media as never} browserLanguage={lang === 'de' ? 'de-DE' : 'en-US'}>
      <PopupApp {...deps} />
    </SettingsProvider>,
  );
  return { user, deps, view };
}

const text = {
  de: { detected: 'Automatisch erkannt: Titel', auto: 'Automatisch erkannt', click: 'Per Klick zugeordnet', manual: 'Selbst eingeben', required: 'Headline (Pflicht)', pick: 'Price auf der Seite anklicken' },
  en: { detected: 'Detected automatically: Title', auto: 'Detected automatically', click: 'Assigned by click', manual: 'Enter it yourself', required: 'Headline (required)', pick: 'Click Price on the page' },
} as const;

describe.each(['de', 'en'] as const)('popup form (%s)', (lang) => {
  const tx = text[lang];

  it('shows the origin of every field as an icon with accessible name and tooltip', async () => {
    setup(lang);
    await screen.findByLabelText(tx.required);
    for (const name of [tx.detected, tx.auto, tx.click, tx.manual]) {
      const mark = screen.getAllByRole('img', { name })[0]!;
      expect(mark.getAttribute('tabindex')).toBe('0');
      const tip = document.getElementById(mark.getAttribute('aria-describedby')!)!;
      expect(tip.getAttribute('role')).toBe('tooltip');
      expect(tip.textContent).toBe(name);
    }
    // Own schema path and meta tag are both only "detected automatically".
    expect(screen.getAllByRole('img', { name: tx.auto })).toHaveLength(2);
  });

  it('shows the user edit as entered by hand', async () => {
    const { user } = setup(lang);
    const input = await screen.findByLabelText(tx.required);
    await user.type(input, 'x');
    expect(within(input.closest('.q-field') as HTMLElement).getByRole('img', { name: tx.manual })).toBeTruthy();
  });

  it('has the pick button with accessible name and tooltip and starts the picker', async () => {
    const { user, deps } = setup(lang);
    const button = await screen.findByRole('button', { name: tx.pick });
    expect(document.getElementById(button.getAttribute('aria-describedby')!)!.textContent).toBe(lang === 'de' ? 'Auf der Seite anklicken' : 'Click on the page');
    await user.click(button);
    expect(deps.pick).toHaveBeenCalledWith(7, 'p0', 'price');
  });

  it('marks required fields with text and the attribute, and shows the error at the field', async () => {
    const { user } = setup(lang, { read: async () => ({ ...(await okRead()), result: { ...(await okRead() as { result: object }).result, fields: {} } }) as never });
    const input = (await screen.findByLabelText(tx.required)) as HTMLInputElement;
    expect(input.required).toBe(true);
    expect((screen.getByLabelText('Author') as HTMLInputElement).required).toBe(false);
    await user.click(screen.getByRole('button', { name: lang === 'de' ? 'An Hook senden' : 'Send to Hook' }));
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const errorId = input.getAttribute('aria-describedby')!;
    expect(document.getElementById(errorId)!.textContent).toBe(lang === 'de' ? 'Bitte ausfüllen.' : 'Please fill this in.');
  });

  it('shows the header with domain, project choice and a settings button', async () => {
    const { user, deps } = setup(lang, { cfg: config([target], 2) });
    await screen.findByLabelText(tx.required);
    expect(screen.getByText('example.com')).toBeTruthy();
    expect(screen.getByLabelText(lang === 'de' ? 'Projekt' : 'Project')).toBeTruthy();
    const gear = screen.getByRole('button', { name: lang === 'de' ? 'Optionen öffnen' : 'Open options' });
    expect(document.getElementById(gear.getAttribute('aria-describedby')!)!.getAttribute('role')).toBe('tooltip');
    await user.click(gear);
    expect(deps.openOptions).toHaveBeenCalled();
  });

  it('shows no technical terms in the visible text', async () => {
    const { view } = setup(lang);
    await screen.findByLabelText(tx.required);
    const visible = view.container.textContent ?? '';
    const labels = [...view.container.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label'));
    for (const term of [/schema/i, /json-?ld/i, /\bmeta/i, /selector/i, /selektor/i, /header/i, /feldschl/i]) {
      expect(visible).not.toMatch(term);
      expect(labels.join(' ')).not.toMatch(term);
    }
  });
});

describe.each(['de', 'en'] as const)('popup states (%s)', (lang) => {
  const de_ = lang === 'de';

  it('loading has its own view', async () => {
    setup(lang, { getActiveTab: () => new Promise(() => undefined) });
    expect((await screen.findByRole('status')).textContent).toBe(de_ ? de['popup.loading'] : en['popup.loading']);
  });

  it('unreadable page offers the options page', async () => {
    const read = async (): Promise<ReadTabResult> => ({ ok: false, kind: 'unsupported', message: 'x' });
    const { user, deps } = setup(lang, { read });
    expect((await screen.findByRole('alert')).textContent).toContain(de_ ? de['popup.unreadable.title'] : en['popup.unreadable.title']);
    await user.click(screen.getByRole('button', { name: de_ ? 'Optionen öffnen' : 'Open options' }));
    expect(deps.openOptions).toHaveBeenCalled();
  });

  it('no access offers a retry that reads again', async () => {
    let calls = 0;
    const read = vi.fn(async (): Promise<ReadTabResult> => (++calls === 1 ? { ok: false, kind: 'no-access', message: 'x' } : okRead()));
    const { user } = setup(lang, { read });
    expect((await screen.findByRole('alert')).textContent).toContain(de_ ? de['popup.noAccess.title'] : en['popup.noAccess.title']);
    await user.click(screen.getByRole('button', { name: de_ ? 'Erneut versuchen' : 'Try again' }));
    expect(await screen.findByLabelText(de_ ? 'Headline (Pflicht)' : 'Headline (required)')).toBeTruthy();
  });

  it('no projects offers to create one', async () => {
    const { user, deps } = setup(lang, { cfg: { [CONFIG_KEY]: { schemaVersion: 1, projects: [] } } });
    await user.click(await screen.findByRole('button', { name: de_ ? 'Projekt anlegen' : 'Create project' }));
    expect(deps.openOptions).toHaveBeenCalled();
  });

  it('no target keeps header and offers the options page', async () => {
    const { user, deps } = setup(lang, { cfg: config([]) });
    expect(await screen.findByText(de_ ? de['popup.noTarget.title'] : en['popup.noTarget.title'])).toBeTruthy();
    expect(screen.getByText('example.com')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: de_ ? 'Ziel anlegen' : 'Add target' }));
    expect(deps.openOptions).toHaveBeenCalled();
  });

  it('missing permission has its own view with the way to the options', async () => {
    const { user, deps } = setup(lang, {
      resultStorage: fakeStorage({ [RESULTS_KEY]: [{ url: URL_A, targets: { 't1-0': { outcome: { kind: 'no-permission', message: 'x' }, at: '2026-01-01T00:00:00.000Z' } } }] }),
    });
    const view = await screen.findByText(de_ ? de['popup.noPermission.title'] : en['popup.noPermission.title']);
    expect(view.closest('[role="alert"]')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: de_ ? 'Berechtigung erteilen' : 'Grant permission' }));
    expect(deps.openOptions).toHaveBeenCalled();
  });
});

describe('catalog', () => {
  it('names every detect value', () => {
    for (const v of DETECT_VALUES) {
      expect(de[`popup.detect.${v}` as keyof typeof de], v).toBeTruthy();
      expect(en[`popup.detect.${v}` as keyof typeof en], v).toBeTruthy();
    }
  });
});
