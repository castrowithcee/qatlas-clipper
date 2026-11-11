/** Shared by the page script (entrypoints/highlight.ts) and the popup side; both import only this module's constants. */
export const HIGHLIGHT_PORT_NAME = 'qatlas-highlight';
export const HIGHLIGHT_MESSAGE_TYPE = 'highlight';

export const MAX_HIGHLIGHT_ITEMS = 100;
export const MAX_LABEL_LENGTH = 200;
export const MAX_SELECTOR_LENGTH = 2000;

/** Only the field label and its selector ever go to the page: no targets, headers or tokens. */
export interface HighlightItem {
  label: string;
  selector: string;
}

export interface HighlightMessage {
  type: typeof HIGHLIGHT_MESSAGE_TYPE;
  items: HighlightItem[];
}

export const highlightMessage = (items: HighlightItem[]): HighlightMessage => ({ type: HIGHLIGHT_MESSAGE_TYPE, items });

/** Port messages come from outside the page script's own code and are treated as data: invalid entries are dropped. */
export function parseHighlightMessage(raw: unknown): HighlightItem[] | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const msg = raw as { type?: unknown; items?: unknown };
  if (msg.type !== HIGHLIGHT_MESSAGE_TYPE || !Array.isArray(msg.items)) return undefined;
  const items: HighlightItem[] = [];
  for (const entry of msg.items.slice(0, MAX_HIGHLIGHT_ITEMS)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { label, selector } = entry as { label?: unknown; selector?: unknown };
    if (typeof label !== 'string' || typeof selector !== 'string') continue;
    if (selector.length === 0 || selector.length > MAX_SELECTOR_LENGTH) continue;
    items.push({ label: label.slice(0, MAX_LABEL_LENGTH), selector });
  }
  return items;
}
