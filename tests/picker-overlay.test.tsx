// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config';
import { en } from '../src/i18n/catalog';
import { mountPicker } from '../src/picker/overlay';
import { OVERLAY_CSS } from '../src/picker/overlayStyle';
import type { Settings } from '../src/settings/schema';
import { config, fakeStorage } from './helpers/picker';

beforeAll(() => {
  const g = globalThis as unknown as { CSS?: { escape?: (v: string) => string } };
  g.CSS ??= {};
  g.CSS.escape ??= (v: string) => v.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
});

let close: (() => void) | undefined;
afterEach(() => {
  close?.();
  close = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/** Controllable stand-in for the `prefers-color-scheme: dark` media query. */
const stubSystemDark = (initial: boolean) => {
  const target = new EventTarget();
  const mql = Object.assign(target, { matches: initial, media: '' });
  vi.spyOn(window, 'matchMedia').mockReturnValue(mql as unknown as MediaQueryList);
  return (matches: boolean) => {
    mql.matches = matches;
    target.dispatchEvent(new Event('change'));
  };
};

interface SetupOptions {
  url?: string;
  settings?: Partial<Settings>;
  browserLanguage?: string;
  label?: string;
  successDelayMs?: number;
}

const setup = (o: SetupOptions = {}) => {
  (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(o.url ?? 'https://www.example.com/page');
  vi.spyOn(window.navigator, 'language', 'get').mockReturnValue(o.browserLanguage ?? 'en-US');
  document.body.replaceChildren(
    ...new DOMParser().parseFromString(
      '<h1 id="title">Article   headline</h1><div><span>x</span></div><div><span>x</span></div>',
      'text/html',
    ).body.children,
  );
  const cfg = config();
  if (o.label) cfg.projects[0]!.fields[0]!.label = o.label;
  const storage = fakeStorage({ config: cfg, ...(o.settings ? { settings: o.settings } : {}) });
  let push: (s: Settings) => void = () => {};
  close = mountPicker({
    projectId: 'articles',
    fieldKey: 'title',
    storage,
    successDelayMs: o.successDelayMs ?? 5,
    subscribe: (cb) => {
      push = cb;
      return () => {};
    },
  });
  const host = document.documentElement.lastElementChild as HTMLElement;
  const root = host.shadowRoot!;
  return {
    storage,
    host,
    root,
    push: (s: Settings) => push(s),
    q: (s: string) => root.querySelector(s) as HTMLElement,
    text: () => root.textContent ?? '',
  };
};
const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('picker overlay structure', () => {
  it('lives in a shadow root, adds no styles outside it, and guards its host with inline important styles', () => {
    const { host, root } = setup();
    expect(host.shadowRoot).toBe(root);
    expect(root.querySelector('style')).not.toBeNull();
    expect(document.head.querySelectorAll('style, link').length).toBe(0);
    expect(document.body.querySelectorAll('style').length).toBe(0);
    const style = host.getAttribute('style')!;
    expect(style).toMatch(/all: initial !important/);
    expect(style).toMatch(/display: block !important/);
    expect(style).toMatch(/z-index: 2147483647 !important/);
  });

  it('uses design tokens and no fixed colors in the overlay styles', () => {
    const css = OVERLAY_CSS.slice(OVERLAY_CSS.indexOf('*, *::before'));
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\b(rgba?|hsla?)\(/i);
    expect(css).toContain('var(--color-accent)');
    // rem would follow the page's root font size.
    expect(css).not.toMatch(/\d\s*rem\b/);
    expect(OVERLAY_CSS).toMatch(/--space-2: 8px/);
  });

  it('highlights on hover and keeps the bar hidden until settings are loaded', async () => {
    const { q } = setup();
    expect(q('.bar').hidden).toBe(true);
    await flush();
    expect(q('.bar').hidden).toBe(false);
    expect(q('.box').style.display).not.toBe('block');
    document.getElementById('title')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(q('.box').style.display).toBe('block');
  });
});

describe('language', () => {
  it('shows English texts for an English browser with automatic language', async () => {
    const { q, text } = setup();
    await flush();
    expect(q('.title').textContent).toBe('Choose element for "Article title"');
    expect(q('.cancel').textContent).toBe('Cancel');
    expect(q('.confirm').textContent).toBe('Apply');
    expect(text()).toContain(en['picker.prompt']);
    expect(q('.bar').lang).toBe('en');
  });

  it('follows a German browser in automatic mode', async () => {
    const { q } = setup({ browserLanguage: 'de-AT' });
    await flush();
    expect(q('.title').textContent).toBe('Element für „Article title“ wählen');
    expect(q('.cancel').textContent).toBe('Abbrechen');
    expect(q('.confirm').textContent).toBe('Übernehmen');
    expect(q('.bar').lang).toBe('de');
  });

  it('a fixed language setting wins over the browser language and applies live', async () => {
    const { q, push } = setup({ settings: { language: 'de' }, browserLanguage: 'en-US' });
    await flush();
    expect(q('.confirm').textContent).toBe('Übernehmen');
    push({ language: 'en', appearance: 'system', openAs: 'popup' });
    expect(q('.confirm').textContent).toBe('Apply');
  });

  it('shows the Esc hint as a tooltip reachable by keyboard focus', async () => {
    const { q } = setup({ settings: { language: 'de' } });
    await flush();
    const trigger = q('.tipwrap button') as HTMLButtonElement;
    const tip = q('.tip');
    expect(tip.getAttribute('role')).toBe('tooltip');
    expect(tip.textContent).toBe('Esc bricht ab');
    expect(trigger.getAttribute('aria-describedby')).toBe(tip.id);
    expect(trigger.tabIndex).toBe(0);
    expect(OVERLAY_CSS).toContain('.tipwrap:focus-within .tip');
  });

  it('renders the field label as text, never as HTML', async () => {
    const { q, root } = setup({ label: '<img src=x onerror=alert(1)>' });
    await flush();
    expect(q('.title').textContent).toBe('Choose element for "<img src=x onerror=alert(1)>"');
    expect(root.querySelector('img')).toBeNull();
  });
});

describe('appearance', () => {
  it('a fixed light or dark setting sets the host theme', async () => {
    stubSystemDark(true);
    const dark = setup({ settings: { appearance: 'dark' } });
    await flush();
    expect(dark.host.getAttribute('data-theme')).toBe('dark');
    dark.push({ language: 'auto', appearance: 'light', openAs: 'popup' });
    expect(dark.host.getAttribute('data-theme')).toBe('light');
  });

  it('system follows prefers-color-scheme of the page, including changes', async () => {
    const setDark = stubSystemDark(false);
    const { host } = setup();
    await flush();
    expect(host.getAttribute('data-theme')).toBe('light');
    setDark(true);
    expect(host.getAttribute('data-theme')).toBe('dark');
    setDark(false);
    expect(host.getAttribute('data-theme')).toBe('light');
  });

  it('a fixed theme ignores the system preference', async () => {
    stubSystemDark(true);
    const { host } = setup({ settings: { appearance: 'light' } });
    await flush();
    expect(host.getAttribute('data-theme')).toBe('light');
  });
});

describe('picking', () => {
  it('click shows the preview, blocks page handlers, and keeps the selector in the details tooltip only', async () => {
    const { q, text } = setup();
    await flush();
    const h1 = document.getElementById('title')!;
    const pageHandler = vi.fn();
    h1.addEventListener('click', pageHandler);
    click(h1);
    expect(pageHandler).not.toHaveBeenCalled();
    expect(q('.preview-text').textContent).toBe('Article headline');
    expect(q('.box').className).toContain('picked');
    expect((q('.confirm') as HTMLButtonElement).disabled).toBe(false);
    const detailsTip = q('.tip.mono');
    expect(detailsTip.textContent).toBe('#title');
    expect(detailsTip.parentElement!.hidden).toBe(false);
    expect(detailsTip.previousElementSibling!.getAttribute('aria-label')).toBe('Technical details');
    // Everything outside the tooltip is free of the selector.
    detailsTip.textContent = '';
    expect(text()).not.toContain('#title');
  });

  it('shows the placeholder for elements without text', async () => {
    const { q } = setup();
    await flush();
    const empty = document.createElement('div');
    empty.id = 'empty';
    document.body.append(empty);
    click(empty);
    expect(q('.preview-text').textContent).toBe('(no text)');
  });

  it('non-unique element shows the understandable hint without a selector, and re-picking works', async () => {
    const { q, text } = setup();
    await flush();
    click(document.querySelectorAll('span')[0]!);
    expect(q('.hint').textContent).toBe('This element is not unique. Choose another one.');
    expect(q('.hint').classList.contains('warn')).toBe(true);
    expect(q('.hint svg')).not.toBeNull();
    expect(q('.box').className).toContain('invalid');
    expect((q('.confirm') as HTMLButtonElement).disabled).toBe(true);
    const detailsTip = q('.tip.mono');
    expect(detailsTip.textContent).toBe('');
    expect(detailsTip.parentElement!.hidden).toBe(true);
    expect(text()).not.toMatch(/ancestor|selector|span|div/i);
    click(document.getElementById('title')!);
    expect(q('.hint').hidden).toBe(true);
    expect((q('.confirm') as HTMLButtonElement).disabled).toBe(false);
  });

  it('the non-unique hint is German in German mode', async () => {
    const { q } = setup({ settings: { language: 'de' } });
    await flush();
    click(document.querySelectorAll('span')[0]!);
    expect(q('.hint').textContent).toBe('Dieses Element ist nicht eindeutig. Wähle ein anderes.');
  });

  it('truncates long previews and a second mount replaces the first', () => {
    const para = document.createElement('p');
    para.id = 'long';
    para.textContent = 'a'.repeat(1000);
    document.body.replaceChildren(para);
    const first = mountPicker({ projectId: 'articles', fieldKey: 'title', storage: fakeStorage(), subscribe: () => () => {} });
    close = mountPicker({ projectId: 'articles', fieldKey: 'title', storage: fakeStorage(), subscribe: () => () => {} });
    expect(first).not.toBe(close);
    click(document.getElementById('long')!);
    const hosts = [...document.documentElement.children].filter((c) => c.shadowRoot);
    expect(hosts.length).toBe(1);
    expect(hosts[0]!.shadowRoot!.querySelector('.preview-text')!.textContent!.length).toBeLessThan(260);
  });

  it('places the bar on the side away from the picked element', async () => {
    const { q } = setup();
    await flush();
    const h1 = document.getElementById('title')!;
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800);
    vi.spyOn(h1, 'getBoundingClientRect').mockReturnValue({ top: 700, height: 20, left: 0, width: 100 } as DOMRect);
    click(h1);
    expect(q('.bar').classList.contains('top')).toBe(true);
    vi.spyOn(h1, 'getBoundingClientRect').mockReturnValue({ top: 10, height: 20, left: 0, width: 100 } as DOMRect);
    click(h1);
    expect(q('.bar').classList.contains('bottom')).toBe(true);
  });
});

describe('closing and saving', () => {
  it('Apply stores the mapping, shows a short success message, then closes', async () => {
    const { q, storage, host } = setup({ successDelayMs: 20 });
    await flush();
    click(document.getElementById('title')!);
    click(q('.confirm'));
    await vi.waitFor(() => expect(q('.done').hidden).toBe(false));
    expect(q('.done').textContent).toBe('Mapping saved');
    expect(q('.row').hidden).toBe(true);
    const cfg = await loadConfig(storage);
    expect(cfg.projects[0]!.siteMappings['example.com']).toEqual({ title: '#title', price: '.p' });
    expect(cfg.projects[0]!.siteMappings['example.org']).toEqual({ title: 'h2' });
    await vi.waitFor(() => expect(host.isConnected).toBe(false));
  });

  it('shows a localized error and stays open when saving fails (non-http page)', async () => {
    const { q, host } = setup({ url: 'about:blank' });
    await flush();
    click(document.getElementById('title')!);
    click(q('.confirm'));
    await flush();
    expect(q('.error').textContent).toMatch(/^The mapping could not be saved: .*http/);
    expect(q('.error').hidden).toBe(false);
    expect((q('.confirm') as HTMLButtonElement).disabled).toBe(false);
    expect(host.isConnected).toBe(true);
  });

  it('Escape removes the overlay, leaves storage untouched, and no listeners remain', async () => {
    const { storage, host } = setup();
    await flush();
    const before = structuredClone(storage.data);
    const h1 = document.getElementById('title')!;
    click(h1);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(host.isConnected).toBe(false);
    expect(storage.data).toEqual(before);
    const handler = vi.fn();
    h1.addEventListener('click', handler);
    click(h1);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('Cancel removes the overlay without saving', async () => {
    const { q, storage, host } = setup();
    await flush();
    const before = structuredClone(storage.data);
    click(document.getElementById('title')!);
    click(q('.cancel'));
    await flush();
    expect(host.isConnected).toBe(false);
    expect(storage.data).toEqual(before);
  });
});
