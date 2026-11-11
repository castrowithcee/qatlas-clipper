import { loadConfig, type StorageArea } from '../config';
import { createTranslator, resolveLanguage } from '../i18n';
import { DEFAULT_SETTINGS, type Settings } from '../settings/schema';
import { loadSettings, subscribeSettings } from '../settings/storage';
import { DARK_QUERY, resolveTheme } from '../ui/theme';
import { getActivePickerClose, setActivePicker } from './active';
import { normalizeDomain, saveMapping } from './mapping';
import { HOST_STYLE, OVERLAY_CSS } from './overlayStyle';
import { generateSelector } from './selector';

export const PREVIEW_MAX_LENGTH = 200;
/** How long the success message stays before the overlay closes. */
export const SUCCESS_DELAY_MS = 1000;

export interface PickerOptions {
  projectId: string;
  fieldKey: string;
  storage?: StorageArea;
  doc?: Document;
  successDelayMs?: number;
  /** Listens for device setting changes; defaults to the extension storage events. */
  subscribe?: (onChange: (settings: Settings) => void) => () => void;
}

const previewText = (el: Element): string => {
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  return text.length > PREVIEW_MAX_LENGTH ? `${text.slice(0, PREVIEW_MAX_LENGTH)}…` : text;
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICON_PATHS = {
  alert: ['m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3', 'M12 9v4', 'M12 17h.01'],
  error: ['M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0', 'm15 9-6 6', 'm9 9 6 6'],
  check: ['M20 6 9 17l-5-5'],
};

/** Mounts the picker overlay on the page. A previously running picker, even from another script load, is closed first. */
export function mountPicker(opts: PickerOptions): () => void {
  getActivePickerClose()?.();
  const doc = opts.doc ?? document;
  const win = doc.defaultView ?? window;

  const host = doc.createElement('div');
  host.setAttribute('style', HOST_STYLE);
  const root = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = OVERLAY_CSS;

  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: ParentNode): HTMLElementTagNameMap[K] => {
    const n = doc.createElement(tag);
    n.className = cls;
    parent.append(n);
    return n;
  };
  const icon = (name: keyof typeof ICON_PATHS, parent: Element): void => {
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    for (const d of ICON_PATHS[name]) {
      const path = doc.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      svg.append(path);
    }
    parent.append(svg);
  };
  const box = make('div', 'box', root);
  const bar = make('div', 'bar bottom', root);
  bar.setAttribute('role', 'group');
  bar.hidden = true;
  const line = make('div', 'line', bar);
  const title = make('span', 'title', line);
  const keyHint = make('span', 'keyhint', line);
  make('span', 'spacer', line);
  const cancel = make('button', 'cancel', line);
  cancel.type = 'button';
  const hint = make('div', 'hint', bar);
  hint.setAttribute('role', 'status');
  const error = make('div', 'error', bar);
  error.setAttribute('role', 'alert');
  const done = make('div', 'done', bar);
  done.setAttribute('role', 'status');
  const doneText = doc.createElement('span');
  const preview = make('div', 'preview', bar);
  const previewLabel = make('span', 'preview-label', preview);
  const previewValue = make('span', 'preview-text', preview);
  root.prepend(style);
  doc.documentElement.append(host);

  let settings: Settings = DEFAULT_SETTINGS;
  let label = opts.fieldKey;
  let ready = false;
  let phase: 'pick' | 'saving' | 'saved' = 'pick';
  let hovered: Element | undefined;
  /** Element the last click could not map uniquely; stays marked until the pointer moves to another element. */
  let invalid: Element | undefined;
  let previewContent = '';
  let savedSite = '';
  let saveError: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const media = typeof win.matchMedia === 'function' ? win.matchMedia(DARK_QUERY) : undefined;

  const render = (): void => {
    const tr = createTranslator(resolveLanguage(settings.language, win.navigator.language || ''));
    host.setAttribute('data-theme', resolveTheme(settings.appearance, media?.matches ?? false));
    bar.lang = tr.language;
    bar.hidden = !ready;
    const heading = tr.t('picker.title', { field: label });
    title.textContent = heading;
    bar.setAttribute('aria-label', heading);
    keyHint.textContent = tr.t('picker.keyHint');
    cancel.textContent = tr.t('picker.cancel');
    line.hidden = phase === 'saved';
    hint.hidden = phase !== 'pick' || !invalid;
    hint.replaceChildren();
    if (invalid) {
      icon('alert', hint);
      const hintText = doc.createElement('span');
      hintText.textContent = tr.t('picker.notUnique');
      hint.append(hintText);
    }
    error.hidden = !saveError;
    error.replaceChildren();
    if (saveError) {
      icon('error', error);
      const t = doc.createElement('span');
      t.textContent = tr.t('picker.saveFailed', { message: saveError });
      error.append(t);
    }
    done.hidden = phase !== 'saved';
    done.replaceChildren();
    icon('check', done);
    doneText.textContent = tr.t('picker.saved', { site: savedSite });
    done.append(doneText);
    previewLabel.textContent = tr.t('picker.preview');
    previewValue.textContent = previewContent || tr.t('picker.previewEmpty');
    preview.hidden = phase !== 'saved';
  };

  const applySettings = (next: Settings): void => {
    settings = next;
    render();
  };
  media?.addEventListener?.('change', render);
  let unsubscribe = () => {};
  try {
    unsubscribe = (opts.subscribe ?? subscribeSettings)(applySettings);
  } catch {
    // No extension storage events here (for example in a plain page test); the loaded settings still apply.
  }
  render();

  void Promise.allSettled([
    loadSettings(opts.storage).then(applySettings),
    loadConfig(opts.storage).then((cfg) => {
      const found = cfg.projects.find((p) => p.id === opts.projectId)?.fields.find((f) => f.key === opts.fieldKey)?.label;
      if (found) label = found;
    }),
  ]).then(() => {
    ready = true;
    render();
  });

  const intersects = (a: DOMRect, b: DOMRect): boolean =>
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const place = (el: Element): void => {
    const r = el.getBoundingClientRect();
    box.className = `box${el === invalid ? ' invalid' : ''}`;
    box.setAttribute('style', `display:block;top:${r.top}px;left:${r.left}px;width:${r.width}px;height:${r.height}px;`);
    // The bar keeps its side; it moves only when it would cover the element under the pointer.
    const bar0 = bar.getBoundingClientRect();
    if (!intersects(r, bar0)) return;
    const margin = 8;
    const other = bar.classList.contains('bottom')
      ? { top: margin, bottom: margin + bar0.height }
      : { top: win.innerHeight - margin - bar0.height, bottom: win.innerHeight - margin };
    if (r.top < other.bottom && r.bottom > other.top && r.height > 0 && r.top < other.top && r.bottom > other.bottom) return;
    const toTop = bar.classList.contains('bottom');
    bar.classList.toggle('top', toTop);
    bar.classList.toggle('bottom', !toTop);
  };
  const onOver = (e: Event): void => {
    const t = e.target;
    if (!(t instanceof win.Element) || t === host || phase !== 'pick') return;
    if (invalid && t !== invalid) {
      invalid = undefined;
      render();
    }
    hovered = t;
    place(t);
  };
  const onClick = (e: Event): void => {
    const t = e.target;
    if (t === host) return; // overlay UI handles its own clicks
    e.preventDefault();
    e.stopPropagation();
    if (phase !== 'pick' || !(t instanceof win.Element)) return;
    const res = generateSelector(t);
    saveError = undefined;
    hovered = t;
    if (!res.unique) {
      invalid = t;
      place(t);
      render();
      return;
    }
    invalid = undefined;
    previewContent = previewText(t);
    phase = 'saving';
    render();
    saveMapping(
      { projectId: opts.projectId, fieldKey: opts.fieldKey, pageUrl: win.location.href, selector: res.selector },
      opts.storage,
    ).then(
      () => {
        if (getActivePickerClose() !== close) return; // closed while saving
        savedSite = normalizeDomain(win.location.href);
        phase = 'saved';
        box.className = 'box picked';
        render();
        timer = setTimeout(close, opts.successDelayMs ?? SUCCESS_DELAY_MS);
      },
      (err: unknown) => {
        phase = 'pick';
        saveError = err instanceof Error ? err.message : String(err);
        render();
      },
    );
  };
  const onKey = (e: Event): void => {
    if ((e as KeyboardEvent).key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };
  // The frame follows its element while scrolling; it never stays behind at an old position.
  const reposition = (): void => {
    if (hovered?.isConnected) place(hovered);
    else box.style.display = 'none';
  };

  const close = (): void => {
    clearTimeout(timer);
    unsubscribe();
    media?.removeEventListener?.('change', render);
    doc.removeEventListener('mouseover', onOver, true);
    doc.removeEventListener('click', onClick, true);
    doc.removeEventListener('keydown', onKey, true);
    win.removeEventListener('scroll', reposition, true);
    win.removeEventListener('resize', reposition);
    host.remove();
    if (getActivePickerClose() === close) setActivePicker(undefined);
  };

  cancel.addEventListener('click', close);
  doc.addEventListener('mouseover', onOver, true);
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('keydown', onKey, true);
  win.addEventListener('scroll', reposition, true);
  win.addEventListener('resize', reposition);
  setActivePicker(close);
  return close;
}
