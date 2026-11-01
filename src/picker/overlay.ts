import { loadConfig, type StorageArea } from '../config';
import { createTranslator, resolveLanguage } from '../i18n';
import { DEFAULT_SETTINGS, type Settings } from '../settings/schema';
import { loadSettings, subscribeSettings } from '../settings/storage';
import { DARK_QUERY, resolveTheme } from '../ui/theme';
import { saveMapping } from './mapping';
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

let active: (() => void) | undefined;

const previewText = (el: Element): string => {
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  return text.length > PREVIEW_MAX_LENGTH ? `${text.slice(0, PREVIEW_MAX_LENGTH)}…` : text;
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICON_PATHS = {
  info: ['M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0', 'M12 11v5M12 8h.01'],
  alert: ['M12 4l9 16H3zM12 10v4M12 17h.01'],
  error: ['M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0', 'M9 9l6 6M15 9l-6 6'],
  check: ['M5 12.5l4.5 4.5L19 7'],
};

/** Mounts the picker overlay on the page. A previously running picker is closed first. */
export function mountPicker(opts: PickerOptions): () => void {
  active?.();
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
  let tipCount = 0;
  const tipWrap = (parent: ParentNode, mono: boolean): { wrap: HTMLElement; trigger: HTMLButtonElement; tip: HTMLElement } => {
    const wrap = make('span', 'tipwrap', parent);
    const trigger = make('button', 'small', wrap);
    trigger.type = 'button';
    const tip = make('span', mono ? 'tip mono' : 'tip', wrap);
    tip.id = `tip-${tipCount++}`;
    tip.setAttribute('role', 'tooltip');
    trigger.setAttribute('aria-describedby', tip.id);
    return { wrap, trigger, tip };
  };

  const box = make('div', 'box', root);
  const bar = make('div', 'bar bottom', root);
  bar.setAttribute('role', 'group');
  bar.hidden = true;
  const title = make('div', 'title', bar);
  const preview = make('div', 'preview', bar);
  const previewLabel = make('span', 'preview-label', preview);
  const previewValue = make('span', 'preview-text', preview);
  const hint = make('div', 'hint', bar);
  hint.setAttribute('role', 'status');
  const error = make('div', 'error', bar);
  error.setAttribute('role', 'alert');
  const row = make('div', 'row', bar);
  const keyTip = tipWrap(row, false);
  keyTip.trigger.textContent = 'Esc';
  const detailsTip = tipWrap(row, true);
  icon('info', detailsTip.trigger);
  make('span', 'spacer', row);
  const cancel = make('button', 'cancel', row);
  cancel.type = 'button';
  const confirm = make('button', 'confirm primary', row);
  confirm.type = 'button';
  const done = make('div', 'done', bar);
  done.setAttribute('role', 'status');
  const doneText = doc.createElement('span');
  root.prepend(style);
  doc.documentElement.append(host);

  let settings: Settings = DEFAULT_SETTINGS;
  let label = opts.fieldKey;
  let ready = false;
  let phase: 'pick' | 'saving' | 'saved' = 'pick';
  let picked: Element | undefined;
  let selector: string | null = null;
  let previewContent = '';
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
    previewLabel.textContent = tr.t('picker.preview');
    previewValue.textContent = previewContent || tr.t('picker.previewEmpty');
    preview.hidden = !picked;
    const notUnique = !!picked && !selector;
    hint.hidden = phase !== 'pick' || (!!picked && !notUnique);
    hint.classList.toggle('warn', notUnique);
    hint.replaceChildren();
    if (notUnique) icon('alert', hint);
    const hintText = doc.createElement('span');
    hintText.textContent = tr.t(notUnique ? 'picker.notUnique' : 'picker.prompt');
    hint.append(hintText);
    error.hidden = !saveError;
    error.replaceChildren();
    if (saveError) {
      icon('error', error);
      const t = doc.createElement('span');
      t.textContent = tr.t('picker.saveFailed', { message: saveError });
      error.append(t);
    }
    const hintLabel = tr.t('picker.keyHintLabel');
    keyTip.trigger.setAttribute('aria-label', hintLabel);
    keyTip.tip.textContent = tr.t('picker.keyHint');
    const detailsLabel = tr.t('picker.details');
    detailsTip.trigger.setAttribute('aria-label', detailsLabel);
    detailsTip.tip.textContent = selector ?? '';
    detailsTip.wrap.hidden = !selector;
    cancel.textContent = tr.t('picker.cancel');
    confirm.textContent = tr.t('picker.confirm');
    confirm.disabled = !selector || phase !== 'pick';
    row.hidden = phase === 'saved';
    preview.hidden = !picked || phase === 'saved';
    done.hidden = phase !== 'saved';
    done.replaceChildren();
    icon('check', done);
    doneText.textContent = tr.t('picker.saved');
    done.append(doneText);
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

  const place = (el: Element, cls: string): void => {
    const r = el.getBoundingClientRect();
    box.className = `box ${cls}`.trim();
    box.setAttribute(
      'style',
      `display:block;top:${r.top}px;left:${r.left}px;width:${r.width}px;height:${r.height}px;`,
    );
    // The bar sits on the side of the viewport away from the element.
    const atTop = r.top + r.height / 2 > win.innerHeight / 2;
    bar.classList.toggle('top', atTop);
    bar.classList.toggle('bottom', !atTop);
  };
  const onOver = (e: Event): void => {
    const t = e.target;
    if (!(t instanceof win.Element) || t === host || picked) return;
    place(t, '');
  };
  const onClick = (e: Event): void => {
    const t = e.target;
    if (t === host) return; // overlay UI handles its own clicks
    e.preventDefault();
    e.stopPropagation();
    if (phase !== 'pick' || !(t instanceof win.Element)) return;
    picked = t;
    const res = generateSelector(t);
    selector = res.unique ? res.selector : null;
    previewContent = previewText(t);
    saveError = undefined;
    place(t, res.unique ? 'picked' : 'invalid');
    render();
  };
  const onKey = (e: Event): void => {
    if ((e as KeyboardEvent).key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };
  const reposition = (): void => {
    if (picked) place(picked, selector ? 'picked' : 'invalid');
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
    if (active === close) active = undefined;
  };

  cancel.addEventListener('click', close);
  confirm.addEventListener('click', () => {
    if (!selector || phase !== 'pick') return;
    phase = 'saving';
    saveError = undefined;
    render();
    saveMapping(
      { projectId: opts.projectId, fieldKey: opts.fieldKey, pageUrl: win.location.href, selector },
      opts.storage,
    ).then(
      () => {
        phase = 'saved';
        render();
        timer = setTimeout(close, opts.successDelayMs ?? SUCCESS_DELAY_MS);
      },
      (err: unknown) => {
        phase = 'pick';
        saveError = err instanceof Error ? err.message : String(err);
        render();
      },
    );
  });
  doc.addEventListener('mouseover', onOver, true);
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('keydown', onKey, true);
  win.addEventListener('scroll', reposition, true);
  win.addEventListener('resize', reposition);
  active = close;
  return close;
}
