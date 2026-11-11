// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config';
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
    expect(q('.keyhint').textContent).toBe('Esc cancels');
    expect(text()).not.toContain('Apply');
    expect(q('.bar').lang).toBe('en');
  });

  it('follows a German browser in automatic mode', async () => {
    const { q } = setup({ browserLanguage: 'de-AT' });
    await flush();
    expect(q('.title').textContent).toBe('Element für „Article title“ wählen');
    expect(q('.cancel').textContent).toBe('Abbrechen');
    expect(q('.keyhint').textContent).toBe('Esc bricht ab');
    expect(q('.bar').lang).toBe('de');
  });

  it('a fixed language setting wins over the browser language and applies live', async () => {
    const { q, push } = setup({ settings: { language: 'de' }, browserLanguage: 'en-US' });
    await flush();
    expect(q('.cancel').textContent).toBe('Abbrechen');
    push({ language: 'en', appearance: 'system', openAs: 'popup' });
    expect(q('.cancel').textContent).toBe('Cancel');
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
  it('a click saves at once, blocks page handlers, shows site and preview, then closes', async () => {
    const { q, storage, host } = setup({ successDelayMs: 20 });
    await flush();
    const h1 = document.getElementById('title')!;
    const pageHandler = vi.fn();
    h1.addEventListener('click', pageHandler);
    click(h1);
    expect(pageHandler).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(q('.done').hidden).toBe(false));
    expect(q('.done').textContent).toBe('Saved for example.com');
    expect(q('.preview-text').textContent).toBe('Article headline');
    expect(q('.box').className).toContain('picked');
    expect(q('.line').hidden).toBe(true);
    const cfg = await loadConfig(storage);
    expect(cfg.projects[0]!.siteMappings['example.com']).toEqual({ title: '#title', price: '.p' });
    expect(cfg.projects[0]!.siteMappings['example.org']).toEqual({ title: 'h2' });
    await vi.waitFor(() => expect(host.isConnected).toBe(false));
  });

  it('shows the page text only as text', async () => {
    const { q, root } = setup({ successDelayMs: 50 });
    await flush();
    const p = document.createElement('p');
    p.id = 'evil';
    p.textContent = '<img src=x onerror=alert(1)>';
    document.body.append(p);
    click(p);
    await vi.waitFor(() => expect(q('.done').hidden).toBe(false));
    expect(q('.preview-text').textContent).toBe('<img src=x onerror=alert(1)>');
    expect(root.querySelector('img')).toBeNull();
  });

  it('shows the placeholder for elements without text', async () => {
    const { q } = setup({ successDelayMs: 50 });
    await flush();
    const empty = document.createElement('div');
    empty.id = 'empty';
    document.body.append(empty);
    click(empty);
    await vi.waitFor(() => expect(q('.done').hidden).toBe(false));
    expect(q('.preview-text').textContent).toBe('(no text)');
  });

  it('a non-unique element saves nothing, is marked, keeps the picker open, and the next click picks anew', async () => {
    const { q, text, storage, host } = setup({ successDelayMs: 5 });
    await flush();
    const before = structuredClone(storage.data);
    click(document.querySelectorAll('span')[0]!);
    await flush();
    expect(q('.hint').hidden).toBe(false);
    expect(q('.hint').textContent).toBe('This element is not unique. Choose another one.');
    expect(q('.hint').classList.contains('warn')).toBe(false);
    expect(q('.hint svg')).not.toBeNull();
    expect(q('.box').className).toContain('invalid');
    expect(storage.data).toEqual(before);
    expect(host.isConnected).toBe(true);
    expect(text()).not.toMatch(/ancestor|selector/i);
    click(document.getElementById('title')!);
    await vi.waitFor(() => expect(q('.done').hidden).toBe(false));
    expect(q('.hint').hidden).toBe(true);
  });

  it('the non-unique hint is German in German mode', async () => {
    const { q } = setup({ settings: { language: 'de' } });
    await flush();
    click(document.querySelectorAll('span')[0]!);
    expect(q('.hint').textContent).toBe('Dieses Element ist nicht eindeutig. Wähle ein anderes.');
  });

  it('the saved message is German in German mode', async () => {
    const { q } = setup({ settings: { language: 'de' }, successDelayMs: 50 });
    await flush();
    click(document.getElementById('title')!);
    await vi.waitFor(() => expect(q('.done').hidden).toBe(false));
    expect(q('.done').textContent).toBe('Gespeichert für example.com');
  });

  it('a second mount replaces the first and leaves one overlay', () => {
    const first = mountPicker({ projectId: 'articles', fieldKey: 'title', storage: fakeStorage(), subscribe: () => () => {} });
    close = mountPicker({ projectId: 'articles', fieldKey: 'title', storage: fakeStorage(), subscribe: () => () => {} });
    expect(first).not.toBe(close);
    expect([...document.documentElement.children].filter((c) => c.shadowRoot).length).toBe(1);
  });

  it('a mount from a freshly loaded script copy closes the running picker and its listeners', async () => {
    const { host } = setup();
    await flush();
    const el = document.getElementById('title')!;
    const spy = vi.spyOn(document, 'addEventListener');
    vi.resetModules();
    const fresh = await import('../src/picker/overlay');
    const storage = fakeStorage({ config: config() });
    close = fresh.mountPicker({ projectId: 'articles', fieldKey: 'title', storage, subscribe: () => () => {} });
    expect(host.isConnected).toBe(false);
    expect([...document.documentElement.children].filter((c) => c.shadowRoot).length).toBe(1);
    // One set of listeners remains: one click saves exactly one mapping.
    const sets = vi.spyOn(storage, 'set');
    await flush();
    click(el);
    await flush();
    await flush();
    expect(sets).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls.filter(([type]) => type === 'click').length).toBe(1);
  });

  it('the bar keeps its side on hover and moves only when it would cover the element', async () => {
    const { q } = setup();
    await flush();
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800);
    const bar = q('.bar');
    vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue({ top: 700, bottom: 780, left: 0, right: 600, height: 80, width: 600 } as DOMRect);
    const rect = (top: number, h: number) => ({ top, bottom: top + h, left: 10, right: 110, height: h, width: 100 }) as DOMRect;
    const over = (el: Element) => el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const h1 = document.getElementById('title')!;
    const [a, b] = document.querySelectorAll('span');
    vi.spyOn(h1, 'getBoundingClientRect').mockReturnValue(rect(10, 20));
    vi.spyOn(a!, 'getBoundingClientRect').mockReturnValue(rect(600, 20));
    vi.spyOn(b!, 'getBoundingClientRect').mockReturnValue(rect(710, 20));
    over(h1);
    expect(bar.classList.contains('bottom')).toBe(true);
    over(a!);
    expect(bar.classList.contains('bottom')).toBe(true);
    over(b!);
    expect(bar.classList.contains('top')).toBe(true);
    over(h1);
    expect(bar.classList.contains('top')).toBe(true);
  });

  it('the frame follows the hovered element while scrolling', async () => {
    const { q } = setup();
    await flush();
    const h1 = document.getElementById('title')!;
    const spy = vi.spyOn(h1, 'getBoundingClientRect').mockReturnValue({ top: 50, bottom: 70, left: 5, right: 105, height: 20, width: 100 } as DOMRect);
    h1.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(q('.box').style.top).toBe('50px');
    spy.mockReturnValue({ top: 20, bottom: 40, left: 5, right: 105, height: 20, width: 100 } as DOMRect);
    window.dispatchEvent(new Event('scroll'));
    expect(q('.box').style.top).toBe('20px');
  });
});

describe('closing and saving', () => {
  it('shows a localized error and stays open when saving fails (non-http page)', async () => {
    const { q, host } = setup({ url: 'about:blank' });
    await flush();
    click(document.getElementById('title')!);
    await flush();
    expect(q('.error').textContent).toMatch(/^The mapping could not be saved: .*http/);
    expect(q('.error').hidden).toBe(false);
    expect(q('.line').hidden).toBe(false);
    expect(host.isConnected).toBe(true);
  });

  it('Escape removes the overlay, leaves storage untouched, and no listeners remain', async () => {
    const { storage, host } = setup();
    await flush();
    const before = structuredClone(storage.data);
    const h1 = document.getElementById('title')!;
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
    q('.cancel').dispatchEvent(new MouseEvent('click'));
    await flush();
    expect(host.isConnected).toBe(false);
    expect(storage.data).toEqual(before);
  });
});
