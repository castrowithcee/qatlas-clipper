import { loadConfig, type StorageArea } from '../config';
import { saveMapping } from './mapping';
import { generateSelector } from './selector';

export const PREVIEW_MAX_LENGTH = 200;

export interface PickerOptions {
  projectId: string;
  fieldKey: string;
  storage?: StorageArea;
  doc?: Document;
}

let active: (() => void) | undefined;

const previewText = (el: Element): string => {
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  return text.length > PREVIEW_MAX_LENGTH ? `${text.slice(0, PREVIEW_MAX_LENGTH)}…` : text;
};

const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; font: 13px/1.4 system-ui, sans-serif; }
.box { position: fixed; display: none; pointer-events: none; border: 2px solid #1a73e8; background: rgba(26,115,232,.15); }
.box.picked { border-color: #188038; background: rgba(24,128,56,.15); }
.bar { position: fixed; left: 8px; right: 8px; bottom: 8px; padding: 8px 12px; background: #202124; color: #fff;
  border-radius: 6px; pointer-events: auto; display: flex; flex-direction: column; gap: 4px; }
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.sel { font-family: ui-monospace, monospace; word-break: break-all; }
.hint { color: #fdd663; } .error { color: #f28b82; }
button { padding: 4px 12px; cursor: pointer; }
button:disabled { cursor: not-allowed; opacity: .5; }
`;

/** Mounts the picker overlay on the page. A previously running picker is closed first. */
export function mountPicker(opts: PickerOptions): () => void {
  active?.();
  const doc = opts.doc ?? document;
  const win = doc.defaultView ?? window;

  const host = doc.createElement('div');
  host.setAttribute('style', 'all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;');
  const root = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = STYLE;
  const box = doc.createElement('div');
  box.className = 'box';
  const bar = doc.createElement('div');
  bar.className = 'bar';
  const make = (tag: string, cls: string, parent: Element, text = ''): HTMLElement => {
    const n = doc.createElement(tag);
    n.className = cls;
    n.textContent = text;
    parent.append(n);
    return n;
  };
  const title = make('div', 'title', bar, `Pick an element for "${opts.fieldKey}" (Esc to cancel)`);
  const preview = make('div', 'preview', bar);
  const selText = make('div', 'sel', bar);
  const hint = make('div', 'hint', bar);
  const error = make('div', 'error', bar);
  const row = make('div', 'row', bar);
  const confirm = make('button', 'confirm', row, 'Confirm') as HTMLButtonElement;
  const cancel = make('button', 'cancel', row, 'Cancel') as HTMLButtonElement;
  confirm.disabled = true;
  root.append(style, box, bar);
  doc.documentElement.append(host);

  void loadConfig(opts.storage)
    .then((cfg) => {
      const label = cfg.projects.find((p) => p.id === opts.projectId)?.fields.find((f) => f.key === opts.fieldKey)?.label;
      if (label) title.textContent = `Pick an element for "${label}" (Esc to cancel)`;
    })
    .catch(() => undefined);

  let picked: Element | undefined;
  let selector: string | null = null;

  const place = (el: Element, cls: string): void => {
    const r = el.getBoundingClientRect();
    box.className = `box ${cls}`;
    box.setAttribute(
      'style',
      `display:block;top:${r.top}px;left:${r.left}px;width:${r.width}px;height:${r.height}px;`,
    );
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
    if (!(t instanceof win.Element)) return;
    picked = t;
    place(t, 'picked');
    preview.textContent = `Preview: ${previewText(t) || '(no text)'}`;
    error.textContent = '';
    const res = generateSelector(t);
    selector = res.unique ? res.selector : null;
    selText.textContent = res.unique ? res.selector : '';
    hint.textContent = res.unique ? '' : `No unique selector: ${res.reason}. Pick another element.`;
    confirm.disabled = !res.unique;
  };
  const onKey = (e: Event): void => {
    if ((e as KeyboardEvent).key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };
  const reposition = (): void => {
    if (picked) place(picked, 'picked');
  };

  const close = (): void => {
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
    if (!selector) return;
    confirm.disabled = true;
    saveMapping(
      { projectId: opts.projectId, fieldKey: opts.fieldKey, pageUrl: win.location.href, selector },
      opts.storage,
    ).then(
      () => close(),
      (err: unknown) => {
        error.textContent = err instanceof Error ? err.message : 'Saving failed';
        confirm.disabled = false;
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
