// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CONFIG_KEY, type StorageArea } from '../src/config';
import type { ReadTabResult } from '../src/extract/inject';
import { DETECT_VALUES } from '../src/extract/detect';
import { PopupApp, type PopupDeps } from '../src/popup/PopupApp';
import { RESULTS_KEY } from '../src/send/results';
import { SETTINGS_KEY, SettingsProvider } from '../src/settings';
import { exportConfig } from '../src/config';
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
    title: 'Article', url: URL_A, content: '', contentFormat: 'markdown', contentTruncated: false, jsonLdTypes: [],
    matchingProjects: [{ id: 'p0', name: 'Alpha0' }], selectedProjectId: 'p0', fields: found,
  } as never,
});

function setup(lang: 'de' | 'en', over: Partial<PopupDeps> & { cfg?: unknown; settings?: ReturnType<typeof fakeStorage> } = {}) {
  const { settings = fakeStorage(), ...rest } = over;
  const deps: PopupDeps = {
    storage: fakeStorage((rest.cfg as Record<string, unknown>) ?? config()),
    draftStorage: fakeStorage(),
    resultStorage: fakeStorage(),
    read: okRead,
    getActiveTab: async () => ({ id: 7, url: URL_A }),
    pick: vi.fn(async () => undefined),
    openOptions: vi.fn(async () => undefined),
    close: vi.fn(),
    permissions: { contains: vi.fn(async () => true) },
    ...rest,
  };
  const user = userEvent.setup();
  const view = render(
    <SettingsProvider storage={settings} subscribe={() => () => undefined} media={media as never} browserLanguage={lang === 'de' ? 'de-DE' : 'en-US'}>
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

  it('shows the always-sent values as read-only rows and repeats nothing in the header', async () => {
    const { user, deps } = setup(lang, { cfg: config([target], 2) });
    await screen.findByLabelText(tx.required);
    const de_ = lang === 'de';
    const group = screen.getByRole('group', { name: de_ ? 'Wird immer mitgesendet' : 'Always sent' });
    const rows: [string, string][] = [
      [de_ ? 'Titel der Seite' : 'Page title', 'Article'],
      [de_ ? 'Adresse der Seite' : 'Page address', URL_A],
      ['Domain', 'example.com'],
      [de_ ? 'Seiteninhalt' : 'Page content', 'Markdown'],
    ];
    for (const [label, value] of rows) {
      const input = within(group).getByLabelText(label) as HTMLInputElement;
      expect(input.value).toBe(value);
      expect(input.readOnly).toBe(true);
      expect(input.disabled).toBe(false);
      await user.type(input, 'x');
      expect(input.value).toBe(value);
    }
    expect(within(screen.getByRole('banner')).queryByText('Article')).toBeNull();
    expect(screen.getByLabelText(lang === 'de' ? 'Projekt' : 'Project')).toBeTruthy();
    const gear = screen.getByRole('button', { name: lang === 'de' ? 'Einstellungen öffnen' : 'Open settings' });
    // The tooltip repeats the name, so it is not announced a second time as a description.
    expect(gear.getAttribute('aria-describedby')).toBeNull();
    await user.hover(gear);
    expect(screen.getAllByRole('tooltip').map((t) => t.textContent)).toContain(gear.getAttribute('aria-label'));
    await user.unhover(gear);
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
    await user.click(screen.getByRole('button', { name: de_ ? 'Einstellungen öffnen' : 'Open settings' }));
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

describe.each(['de', 'en'] as const)('popup send texts (%s)', (lang) => {
  const de_ = lang === 'de';
  const FIXED = [
    'The target could not be reached.', 'The target did not respond in time.', 'The target is not configured for this project.',
    'The extension has no permission for this target address.', 'The send request was invalid.', 'A send to this target is already running.',
    'Sending failed internally.',
  ];
  const kinds = ['network-error', 'timeout', 'unknown-target', 'invalid-request', 'internal-error'] as const;

  it.each(kinds)('shows %s without technical terms and without the fixed English message', async (kind) => {
    const send = vi.fn(async () => ({ kind, message: FIXED[0]! }) as never);
    const { user, view } = setup(lang, { send });
    await user.click(await screen.findByRole('button', { name: de_ ? 'An Hook senden' : 'Send to Hook' }));
    await screen.findByRole('alert');
    const visible = view.container.textContent ?? '';
    for (const fixed of FIXED) expect(visible).not.toContain(fixed);
    if (de_) for (const term of [/webhook/i, /timeout/i, /\bhttp/i, /status/i, /payload/i, /request/i]) expect(visible).not.toMatch(term);
  });

  it('shows a success with a link only for http(s) and in the active language', async () => {
    const send = vi.fn(async () => ({ kind: 'success', status: 200, message: '<b>x</b>', url: 'javascript:alert(1)' }) as never);
    const { user } = setup(lang, { send });
    await user.click(await screen.findByRole('button', { name: de_? 'An Hook senden' : 'Send to Hook' }));
    expect(await screen.findByText(de_ ? /^Gesendet um / : /^Sent at /)).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('<b>x</b>')).toBeTruthy();
  });
});

describe('long values', () => {
  const longValue = ['**Bold** intro', '- one', '- two', '- three', '- four', '- five', '- six'].join('\n');
  const withFound = (value: string, extra: object = {}) => ({
    read: async (): Promise<ReadTabResult> => {
      const base = await okRead();
      return { ...base, result: { ...(base as { result: object }).result, fields: { ...found, size: { value, source: 'selector' }, ...extra } } } as never;
    },
  });

  it('shows no "Show more" for a short value', async () => {
    setup('en', withFound('line 1\nline 2'));
    await screen.findByLabelText('Size');
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('offers "Show more" with an aria-hidden fade for a long value; the full text stays in the field', async () => {
    const { view } = setup('de', withFound(longValue));
    const button = await screen.findByRole('button', { name: 'Mehr anzeigen' });
    expect(button.tagName).toBe('BUTTON');
    const fade = view.container.querySelector('.popup-long-fade')!;
    expect(fade.getAttribute('aria-hidden')).toBe('true');
    expect((button.closest('.popup-long')!.querySelector('textarea') as HTMLTextAreaElement).value).toBe(longValue);
  });

  it('opens a Markdown preview, closes on Escape and returns focus', async () => {
    const { user } = setup('en', withFound(longValue));
    const button = await screen.findByRole('button', { name: 'Show more' });
    await user.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'Size' });
    expect(dialog.querySelector('strong')?.textContent).toBe('Bold');
    expect(dialog.querySelectorAll('li')).toHaveLength(6);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('shows a text value as plain text with line breaks kept', async () => {
    const text = Array.from({ length: 7 }, (_, i) => `**row ${i}**`).join('\n');
    const cfg = config();
    (cfg[CONFIG_KEY] as { projects: { fields: { key: string; format?: string }[] }[] }).projects[0]!.fields = [{ key: 'size', label: 'Size', required: false, format: 'text', sources: {} } as never];
    const { user } = setup('en', { ...withFound(text), cfg });
    await user.click(await screen.findByRole('button', { name: 'Show more' }));
    const dialog = await screen.findByRole('dialog', { name: 'Size' });
    expect(dialog.querySelector('strong')).toBeNull();
    expect(dialog.querySelector('.popup-long-text')!.textContent).toBe(text);
  });

  it('shows an HTML value as source text and not formatted', async () => {
    const html = `<p>Intro</p>\n<ul>\n<li>1</li>\n<li>2</li>\n<li>3</li>\n<li>4</li>\n<li>5</li>\n</ul>`;
    const cfg = config();
    (cfg[CONFIG_KEY] as { projects: { fields: unknown[] }[] }).projects[0]!.fields = [{ key: 'size', label: 'Size', required: false, format: 'html', sources: {} }];
    const { user } = setup('en', { ...withFound(html), cfg });
    expect((await screen.findByLabelText('Size') as HTMLTextAreaElement).value).toBe(html);
    await user.click(await screen.findByRole('button', { name: 'Show more' }));
    const dialog = await screen.findByRole('dialog', { name: 'Size' });
    expect(dialog.querySelector('li, p:not(.popup-long-text)')).toBeNull();
    expect(dialog.querySelector('.popup-long-text')!.textContent).toBe(html);
  });

  it('does not create elements from script or image tags in the preview', async () => {
    const evil = `<script>window.__x=1</script>\n<img src=x onerror="window.__x=2">\n1\n2\n3\n4\n5\n6`;
    const { user } = setup('en', withFound(evil));
    await user.click(await screen.findByRole('button', { name: 'Show more' }));
    const dialog = await screen.findByRole('dialog', { name: 'Size' });
    expect(dialog.querySelector('script, img')).toBeNull();
    expect(dialog.textContent).toContain('<script>');
  });

  it('edits the value from the preview', async () => {
    const { user } = setup('en', withFound(longValue));
    await user.click(await screen.findByRole('button', { name: 'Show more' }));
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const area = screen.getByRole('textbox', { name: 'Edit Size' });
    await user.type(area, ' END');
    expect((document.querySelector('.popup-long-more')!.closest('.popup-long')!.querySelector('textarea') as HTMLTextAreaElement).value).toBe(`${longValue} END`);
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByRole('dialog').textContent).toContain('END');
  });
});

describe.each(['de', 'en'] as const)('highlight switch in the header (%s)', (lang) => {
  const name = lang === 'de' ? de['popup.header.highlight'] : en['popup.header.highlight'];

  it('has name, tooltip and pressed state, and saves a device setting outside the configuration export', async () => {
    const settings = fakeStorage();
    const { user, deps } = setup(lang, { settings });
    const button = await screen.findByRole('button', { name });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.getAttribute('aria-describedby')).toBeNull();
    await user.hover(button);
    expect(screen.getAllByRole('tooltip').map((t) => t.textContent)).toContain(name);
    await user.unhover(button);
    await user.click(button);
    expect(screen.getByRole('button', { name }).getAttribute('aria-pressed')).toBe('false');
    expect((settings.data[SETTINGS_KEY] as { highlight: boolean }).highlight).toBe(false);
    expect(await exportConfig(deps.storage!)).not.toMatch(/highlight/);
    expect(JSON.stringify((deps.storage as ReturnType<typeof fakeStorage>).data)).not.toMatch(/highlight/);
    await user.click(screen.getByRole('button', { name }));
    expect((settings.data[SETTINGS_KEY] as { highlight: boolean }).highlight).toBe(true);
  });

  it('starts off when the stored setting says so', async () => {
    setup(lang, { settings: fakeStorage({ [SETTINGS_KEY]: { highlight: false } }) });
    expect((await screen.findByRole('button', { name })).getAttribute('aria-pressed')).toBe('false');
  });
});

describe.each(['popup', 'sidepanel'] as const)('project choice with tags (%s)', (variant) => {
  const proj = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
    id, name, scope: { allSites: true, domains: [] }, siteMappings: {}, fields: FIELDS, targets: [{ ...target, id: `t-${id}` }], ...extra,
  });
  const cfg = {
    [CONFIG_KEY]: {
      schemaVersion: 1,
      folders: [{ id: 'f1', name: 'Zeta' }],
      tags: [{ id: 't1', name: 'One' }, { id: 't2', name: 'Two <b>' }],
      projects: [proj('p0', 'Match', { tagIds: ['t2', 't1'] }), proj('p1', 'InZeta', { folderId: 'f1', tagIds: ['t1'] }), proj('p2', 'Loose')],
    },
  };

  it('puts the tags behind the name in tag-list order and keeps the grouping', async () => {
    const { view } = setup('en', { cfg, variant } as never);
    const select = (await screen.findByLabelText(en['popup.project.label'])) as HTMLSelectElement;
    const noMatch = (name: string) => en['popup.project.noMatch'].replace('{name}', name);
    const top = [...select.children].filter((c) => c.tagName === 'OPTION').map((c) => c.textContent);
    expect(top).toEqual(['Match · One, Two <b>', noMatch('Loose')]);
    const groups = [...select.querySelectorAll('optgroup')].map((g) => [g.label, [...g.querySelectorAll('option')].map((o) => o.textContent)]);
    expect(groups).toEqual([['Zeta', [noMatch('InZeta · One')]]]);
    expect(select.querySelector('b')).toBeNull();
    view.unmount();
  });
});

describe.each(['popup', 'sidepanel'] as const)('project choice with folders (%s)', (variant) => {
  const proj = (id: string, name: string, folderId?: string) => ({
    id, name, scope: { allSites: true, domains: [] }, siteMappings: {}, fields: FIELDS, targets: [{ ...target, id: `t-${id}` }], ...(folderId ? { folderId } : {}),
  });
  const cfg = {
    [CONFIG_KEY]: {
      schemaVersion: 1,
      folders: [{ id: 'f1', name: 'Zeta' }, { id: 'f2', name: 'Alpha <b>' }],
      projects: [proj('p0', 'Match'), proj('p1', 'InZeta', 'f1'), proj('p2', 'Loose'), proj('p3', 'InAlpha', 'f2'), proj('p4', 'InZeta2', 'f1')],
    },
  };

  it('lists matching first, then unfoldered, then folders in folder order', async () => {
    const { view } = setup('en', { cfg, variant } as never);
    const select = (await screen.findByLabelText(en['popup.project.label'])) as HTMLSelectElement;
    const noMatch = (name: string) => en['popup.project.noMatch'].replace('{name}', name);
    const top = [...select.children].filter((c) => c.tagName === 'OPTION').map((c) => c.textContent);
    expect(top).toEqual(['Match', noMatch('Loose')]);
    const groups = [...select.querySelectorAll('optgroup')].map((g) => [g.label, [...g.querySelectorAll('option')].map((o) => o.textContent)]);
    expect(groups).toEqual([['Zeta', [noMatch('InZeta'), noMatch('InZeta2')]], ['Alpha <b>', [noMatch('InAlpha')]]]);
    expect(select.querySelector('b')).toBeNull();
    view.unmount();
  });
});
