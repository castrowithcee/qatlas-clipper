// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config';
import { mountPicker } from '../src/picker/overlay';
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
});

const setup = (url = 'https://www.example.com/page') => {
  (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(url);
  document.body.replaceChildren(
    ...new DOMParser().parseFromString(
      '<h1 id="title">Article   headline</h1><div><span>x</span></div><div><span>x</span></div>',
      'text/html',
    ).body.children,
  );
  const storage = fakeStorage({ config: config() });
  close = mountPicker({ projectId: 'articles', fieldKey: 'title', storage });
  const host = document.documentElement.lastElementChild as HTMLElement;
  const root = host.shadowRoot!;
  return { storage, host, root, q: (s: string) => root.querySelector(s) as HTMLElement };
};
const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('picker overlay', () => {
  it('lives in a shadow root and adds no styles outside it', () => {
    const { host, root } = setup();
    expect(host.shadowRoot).toBe(root);
    expect(root.querySelector('style')).not.toBeNull();
    expect(document.head.querySelectorAll('style, link').length).toBe(0);
    expect(document.body.querySelectorAll('style').length).toBe(0);
  });

  it('shows the field label and highlights on hover', async () => {
    const { q } = setup();
    await flush();
    expect(q('.title').textContent).toContain('Article title');
    expect(q('.box').style.display).not.toBe('block');
    document.getElementById('title')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(q('.box').style.display).toBe('block');
  });

  it('click shows preview and selector, blocks page handlers, and confirm stores the mapping', async () => {
    const { q, storage, host } = setup();
    const h1 = document.getElementById('title')!;
    const pageHandler = vi.fn();
    h1.addEventListener('click', pageHandler);
    click(h1);
    expect(pageHandler).not.toHaveBeenCalled();
    expect(q('.preview').textContent).toContain('Article headline');
    expect(q('.sel').textContent).toBe('#title');
    expect((q('.confirm') as HTMLButtonElement).disabled).toBe(false);
    click(q('.confirm'));
    await flush();
    const cfg = await loadConfig(storage);
    expect(cfg.projects[0]!.siteMappings['example.com']).toEqual({ title: '#title', price: '.p' });
    expect(cfg.projects[0]!.siteMappings['example.org']).toEqual({ title: 'h2' });
    expect(host.isConnected).toBe(false);
  });

  it('shows an error and stays open when saving fails (non-http page)', async () => {
    const { q, host } = setup('about:blank');
    click(document.getElementById('title')!);
    click(q('.confirm'));
    await flush();
    expect(q('.error').textContent).toMatch(/http/);
    expect(host.isConnected).toBe(true);
  });

  it('Escape removes the overlay, leaves storage untouched, and no listeners remain', async () => {
    const { storage, host } = setup();
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

  it('non-unique selector shows a hint and keeps confirm disabled; re-pick works', () => {
    const { q } = setup();
    click(document.querySelectorAll('span')[0]!);
    expect(q('.hint').textContent).not.toBe('');
    expect((q('.confirm') as HTMLButtonElement).disabled).toBe(true);
    click(document.getElementById('title')!);
    expect(q('.hint').textContent).toBe('');
    expect((q('.confirm') as HTMLButtonElement).disabled).toBe(false);
  });

  it('truncates long previews and a second mount replaces the first', () => {
    const para = document.createElement('p');
    para.id = 'long';
    para.textContent = 'a'.repeat(1000);
    document.body.replaceChildren(para);
    const first = mountPicker({ projectId: 'articles', fieldKey: 'title', storage: fakeStorage() });
    close = mountPicker({ projectId: 'articles', fieldKey: 'title', storage: fakeStorage() });
    expect(first).not.toBe(close);
    click(document.getElementById('long')!);
    const hosts = [...document.documentElement.children].filter((c) => c.shadowRoot);
    expect(hosts.length).toBe(1);
    expect(hosts[0]!.shadowRoot!.querySelector('.preview')!.textContent!.length).toBeLessThan(260);
  });
});
