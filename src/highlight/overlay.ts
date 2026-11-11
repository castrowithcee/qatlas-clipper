import { PICKER_STATE_EVENT, isPickerActive } from '../picker/active';
import { DEFAULT_SETTINGS, type Settings } from '../settings/schema';
import { loadSettings, subscribeSettings } from '../settings/storage';
import { DARK_QUERY, resolveTheme } from '../ui/theme';
import type { StorageArea } from '../config';
import type { HighlightItem } from './messages';
import { HIGHLIGHT_CSS, HOST_STYLE } from './overlayStyle';

export interface HighlightOptions {
  doc?: Document;
  storage?: StorageArea;
  /** Listens for device setting changes; defaults to the extension storage events. */
  subscribe?: (onChange: (settings: Settings) => void) => () => void;
}

export interface HighlightHandle {
  /** Replaces the frames; an empty list shows none. */
  update(items: HighlightItem[]): void;
  /** Removes the host and every listener; nothing of the extension stays in the page. Safe to call twice. */
  close(): void;
}

/**
 * Every injection of the highlight script gets its own copy of this module, but all copies share the isolated world's
 * global object. The running instance's close function lives there so a second load never leaves two hosts behind.
 */
const ACTIVE_KEY = Symbol.for('qatlas.highlight.active');
const globals = globalThis as unknown as Record<symbol, (() => void) | undefined>;

const isVisible = (el: Element, win: Window, rect: DOMRect): boolean => {
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = win.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse';
};

/** First match only; an invalid selector or a missing element yields nothing. */
const findElement = (doc: Document, selector: string): Element | undefined => {
  try {
    return doc.querySelector(selector) ?? undefined;
  } catch {
    return undefined;
  }
};

/** Mounts the highlight overlay. A previously running instance, even from another script load, is closed first. */
export function mountHighlight(opts: HighlightOptions = {}): HighlightHandle {
  globals[ACTIVE_KEY]?.();
  const doc = opts.doc ?? document;
  const win = doc.defaultView ?? window;

  const host = doc.createElement('div');
  host.setAttribute('style', HOST_STYLE);
  const root = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = HIGHLIGHT_CSS;
  const layer = doc.createElement('div');
  root.append(style, layer);
  doc.documentElement.append(host);

  let items: HighlightItem[] = [];
  let settings: Settings = DEFAULT_SETTINGS;
  let closed = false;
  const media = typeof win.matchMedia === 'function' ? win.matchMedia(DARK_QUERY) : undefined;

  const render = (): void => {
    if (closed) return;
    host.setAttribute('data-theme', resolveTheme(settings.appearance, media?.matches ?? false));
    // The picker has its own frame and takes the clicks; the highlight steps aside while it runs.
    layer.hidden = isPickerActive();
    layer.replaceChildren();
    if (layer.hidden) return;
    for (const item of items) {
      const el = findElement(doc, item.selector);
      if (!el || el === host) continue;
      const rect = el.getBoundingClientRect();
      if (!isVisible(el, win, rect)) continue;
      const frame = doc.createElement('div');
      frame.className = rect.top < 28 ? 'frame inside' : 'frame';
      frame.setAttribute('style', `top:${rect.top}px;left:${rect.left}px;width:${rect.width}px;height:${rect.height}px;`);
      const label = doc.createElement('span');
      label.className = 'label';
      label.textContent = item.label;
      frame.append(label);
      layer.append(frame);
    }
  };

  const applySettings = (next: Settings): void => {
    settings = next;
    render();
  };
  let unsubscribe = () => {};
  try {
    unsubscribe = (opts.subscribe ?? subscribeSettings)(applySettings);
  } catch {
    // No extension storage events here (for example in a plain page test); the loaded settings still apply.
  }
  void loadSettings(opts.storage).then(applySettings, () => {});

  // Frames follow their elements while scrolling or resizing; they never stay behind at an old position.
  win.addEventListener('scroll', render, true);
  win.addEventListener('resize', render);
  win.addEventListener(PICKER_STATE_EVENT, render);
  media?.addEventListener?.('change', render);

  const close = (): void => {
    if (closed) return;
    closed = true;
    unsubscribe();
    win.removeEventListener('scroll', render, true);
    win.removeEventListener('resize', render);
    win.removeEventListener(PICKER_STATE_EVENT, render);
    media?.removeEventListener?.('change', render);
    host.remove();
    if (globals[ACTIVE_KEY] === close) globals[ACTIVE_KEY] = undefined;
  };
  globals[ACTIVE_KEY] = close;
  render();

  return {
    update(next) {
      items = next;
      render();
    },
    close,
  };
}
