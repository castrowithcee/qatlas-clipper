// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_HIGHLIGHT_ITEMS, highlightMessage, parseHighlightMessage } from '../src/highlight/messages';
import { mountHighlight } from '../src/highlight/overlay';
import { attachHighlightPort, type HighlightPort } from '../src/highlight/port';
import { setActivePicker } from '../src/picker/active';

const noSubscribe = () => () => {};
const mount = () => mountHighlight({ subscribe: noSubscribe, storage: { get: async () => ({}), set: async () => {} } as never });

const hosts = () => [...document.documentElement.children].filter((n) => n.shadowRoot);
const frames = () => hosts().flatMap((h) => [...h.shadowRoot!.querySelectorAll('.frame')]);
const labels = () => frames().map((f) => f.querySelector('.label')?.textContent);

const rect = (el: Element, r: Partial<DOMRect> = {}) =>
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ top: 100, left: 20, width: 80, height: 30, ...r } as DOMRect);

const setup = () => {
  document.body.replaceChildren(
    ...new DOMParser().parseFromString('<h1 id="a">A</h1><p id="b">B</p><p id="c" style="display:none">C</p>', 'text/html').body
      .children,
  );
  for (const id of ['a', 'b', 'c']) rect(document.getElementById(id)!);
};

afterEach(() => {
  setActivePicker(undefined);
  for (const h of hosts()) h.remove();
  vi.restoreAllMocks();
});

describe('highlight overlay', () => {
  it('draws one frame with the field label per mapped element', () => {
    setup();
    const h = mount();
    h.update([
      { label: 'Title', selector: '#a' },
      { label: 'Body', selector: '#b' },
    ]);
    expect(labels()).toEqual(['Title', 'Body']);
    h.close();
  });

  it('draws nothing for an invalid selector, no match or an invisible element, and does not throw', () => {
    setup();
    const h = mount();
    document.getElementById('a')!.style.visibility = 'hidden';
    rect(document.getElementById('b')!, { width: 0 });
    expect(() =>
      h.update([
        { label: 'x', selector: '##(' },
        { label: 'y', selector: '#missing' },
        { label: 'z', selector: '#a' },
        { label: 'w', selector: '#b' },
        { label: 'v', selector: '#c' },
      ]),
    ).not.toThrow();
    expect(frames()).toHaveLength(0);
    h.close();
  });

  it('treats the label as text', () => {
    setup();
    const h = mount();
    h.update([{ label: '<img src=x onerror=1>', selector: '#a' }]);
    expect(hosts()[0]!.shadowRoot!.querySelector('img')).toBeNull();
    expect(labels()).toEqual(['<img src=x onerror=1>']);
    h.close();
  });

  it('follows scrolling', () => {
    setup();
    const h = mount();
    h.update([{ label: 'Title', selector: '#a' }]);
    rect(document.getElementById('a')!, { top: 40 });
    window.dispatchEvent(new Event('scroll'));
    expect(frames()[0]!.getAttribute('style')).toContain('top:40px');
    h.close();
  });

  it('removes everything on close', () => {
    setup();
    const h = mount();
    h.update([{ label: 'Title', selector: '#a' }]);
    h.close();
    h.close();
    expect(hosts()).toHaveLength(0);
  });

  it('keeps a single instance across script loads', () => {
    setup();
    const first = mount();
    first.update([{ label: 'Title', selector: '#a' }]);
    const second = mount();
    expect(hosts()).toHaveLength(1);
    second.update([{ label: 'Body', selector: '#b' }]);
    expect(labels()).toEqual(['Body']);
    first.close();
    expect(hosts()).toHaveLength(1);
    second.close();
    expect(hosts()).toHaveLength(0);
  });

  it('hides while the picker runs and shows again afterwards', () => {
    setup();
    const h = mount();
    h.update([{ label: 'Title', selector: '#a' }]);
    expect(frames()).toHaveLength(1);
    setActivePicker(() => {});
    expect(frames()).toHaveLength(0);
    setActivePicker(undefined);
    expect(labels()).toEqual(['Title']);
    h.close();
  });

  it('never takes pointer events', () => {
    setup();
    const h = mount();
    const css = hosts()[0]!.shadowRoot!.querySelector('style')!.textContent!;
    expect(css).toContain('pointer-events: none !important');
    expect(css).not.toContain('pointer-events: auto');
    h.close();
  });
});

describe('highlight port', () => {
  const fakePort = () => {
    const msg: Array<(m: unknown) => void> = [];
    const dis: Array<() => void> = [];
    const port: HighlightPort = {
      name: 'x',
      onMessage: { addListener: (cb) => void msg.push(cb) },
      onDisconnect: { addListener: (cb) => void dis.push(cb) },
    };
    return { port, send: (m: unknown) => msg.forEach((f) => f(m)), disconnect: () => dis.forEach((f) => f()) };
  };

  it('sets frames from messages, ignores garbage and removes the host on disconnect', () => {
    setup();
    const p = fakePort();
    attachHighlightPort(p.port, mount);
    p.send(highlightMessage([{ label: 'Title', selector: '#a' }]));
    expect(labels()).toEqual(['Title']);
    p.send('nonsense');
    p.send({ type: 'highlight', items: 5 });
    expect(labels()).toEqual(['Title']);
    p.send(highlightMessage([]));
    expect(frames()).toHaveLength(0);
    p.send(highlightMessage([{ label: 'Title', selector: '#a' }]));
    p.disconnect();
    expect(hosts()).toHaveLength(0);
  });
});

describe('parseHighlightMessage', () => {
  it('keeps only string pairs and limits the count', () => {
    const items = Array.from({ length: MAX_HIGHLIGHT_ITEMS + 5 }, (_, i) => ({ label: `L${i}`, selector: '#a', extra: 1 }));
    const parsed = parseHighlightMessage({ type: 'highlight', items: [{ label: 1, selector: '#a' }, null, ...items] })!;
    expect(parsed).toHaveLength(MAX_HIGHLIGHT_ITEMS - 2);
    expect(parsed[0]).toEqual({ label: 'L0', selector: '#a' });
    expect(parseHighlightMessage({ type: 'other', items: [] })).toBeUndefined();
  });
});
