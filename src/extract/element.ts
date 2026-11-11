import { createMarkdownContent } from 'defuddle/full';
import { sanitizeHtml } from './sanitize';

// Never read: not rendered content, or content that is not text of this page.
const SKIP = new Set(['script', 'style', 'template', 'iframe', 'noscript', 'frame', 'frameset', 'object', 'embed', 'applet', 'head', 'svg', 'math', 'canvas', 'audio', 'video', 'select', 'datalist']);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
// Elements that are kept as such in the intermediate HTML.
const KEEP = new Set([...HEADINGS, 'p', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'a', 'br']);
const BLOCKS = new Set([
  'address', 'article', 'aside', 'blockquote', 'dd', 'details', 'dialog', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer',
  'form', 'header', 'hgroup', 'hr', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'tfoot', 'thead', 'tr', 'ul', 'li',
  ...HEADINGS,
]);
// Computed display values that render as a block; inline-block, inline-flex and contents stay inline.
const BLOCK_DISPLAYS = new Set(['block', 'flex', 'grid', 'list-item', 'table', 'table-row', 'flow-root']);
const BOLD_TAGS = new Set(['strong', 'b', 'th']);
const ITALIC_TAGS = new Set(['em', 'i', 'cite', 'dfn', 'var']);
const LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);

interface Ctx {
  out: Document;
  base: string;
  bold: boolean;
  italic: boolean;
  visible: boolean;
  // Inside a heading the Markdown heading already carries the emphasis.
  inHeading: boolean;
}

function styleOf(el: Element): CSSStyleDeclaration | null {
  try {
    return el.ownerDocument.defaultView?.getComputedStyle(el) ?? null;
  } catch {
    return null;
  }
}

function isBoldWeight(weight: string): boolean {
  if (weight === 'bold' || weight === 'bolder') return true;
  const n = Number.parseInt(weight, 10);
  return Number.isFinite(n) && n >= 600;
}

function hiddenByAttribute(el: Element): boolean {
  return el.hasAttribute('hidden') || el.getAttribute('aria-hidden')?.trim().toLowerCase() === 'true';
}

function wrap(out: Document, tag: string, child: Node): Element {
  const w = out.createElement(tag);
  w.appendChild(child);
  return w;
}

function safeHref(el: Element, base: string): string | null {
  const raw = el.getAttribute('href');
  if (!raw) return null;
  try {
    const u = new URL(raw.trim(), base);
    return LINK_SCHEMES.has(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

/** Appends the visible content of `node` to `parent` as an intermediate tree of a few plain elements. */
function walk(node: Node, parent: Node, ctx: Ctx): void {
  if (node.nodeType === 3) {
    // Text of a hidden-but-inherited ancestor is dropped; a descendant with visibility:visible re-enables it.
    if (!ctx.visible || !node.nodeValue) return;
    let leaf: Node = ctx.out.createTextNode(node.nodeValue);
    if (ctx.italic) leaf = wrap(ctx.out, 'em', leaf);
    if (ctx.bold && !ctx.inHeading) leaf = wrap(ctx.out, 'strong', leaf);
    parent.appendChild(leaf);
    return;
  }
  if (node.nodeType !== 1) return;
  const el = node as Element;
  const tag = el.localName.toLowerCase();
  if (SKIP.has(tag) || hiddenByAttribute(el)) return;
  const cs = styleOf(el);
  if (cs?.display === 'none') return;

  const visibility = cs?.visibility ?? '';
  const visible = visibility === 'hidden' || visibility === 'collapse' ? false : visibility === 'visible' ? true : ctx.visible;
  const weight = cs?.fontWeight ?? '';
  const bold = BOLD_TAGS.has(tag) || (weight ? isBoldWeight(weight) : ctx.bold);
  const italic = ITALIC_TAGS.has(tag) || (cs?.fontStyle ? /^(italic|oblique)/.test(cs.fontStyle) : ctx.italic);
  const child: Ctx = { ...ctx, visible, bold, italic, inHeading: ctx.inHeading || HEADINGS.has(tag) };

  if (tag === 'br') {
    if (visible) parent.appendChild(ctx.out.createElement('br'));
    return;
  }

  // Containers get the element tag, or a div for other block-level elements; inline elements are flattened.
  let target: Node = parent;
  let container: Element | null = null;
  if (tag === 'a') {
    const href = safeHref(el, ctx.base);
    if (href) {
      container = ctx.out.createElement('a');
      container.setAttribute('href', href);
    }
  } else if (KEEP.has(tag)) {
    container = ctx.out.createElement(tag);
  } else if (BLOCKS.has(tag) || BLOCK_DISPLAYS.has(cs?.display ?? '')) {
    container = ctx.out.createElement('div');
  }
  if (container) {
    parent.appendChild(container);
    target = container;
  }
  for (const c of Array.from(el.childNodes)) walk(c, target, child);
}

const EMPHASIS = new Set(['strong', 'em']);

// Emphasis is set per text node; merge neighbours so that "a b" in bold is one strong, and drop empty ones.
function tidy(parent: Element): void {
  let prev: Element | null = null;
  for (const c of Array.from(parent.childNodes)) {
    if (c.nodeType !== 1) {
      prev = null;
      continue;
    }
    const el = c as Element;
    if (EMPHASIS.has(el.localName)) {
      if (prev && prev.localName === el.localName) {
        while (el.firstChild) prev.appendChild(el.firstChild);
        el.remove();
        continue;
      }
      prev = el;
    } else {
      prev = null;
    }
  }
  for (const c of Array.from(parent.children)) tidy(c);
  for (const c of Array.from(parent.children)) {
    if (EMPHASIS.has(c.localName) && !(c.textContent ?? '').trim()) {
      while (c.firstChild) parent.insertBefore(c.firstChild, c);
      c.remove();
    }
  }
}

function build(el: Element, baseUrl: string): Document {
  // Detached, inert document: nothing runs and nothing is attached to the live page.
  const out = new DOMParser().parseFromString('<!doctype html><body>', 'text/html');
  walk(el, out.body, { out, base: baseUrl, bold: false, italic: false, visible: true, inHeading: false });
  tidy(out.body);
  return out;
}

/** Visible text of the element as one line; whitespace collapsed. */
export function elementText(el: Element): string {
  const out = build(el, el.ownerDocument.URL);
  for (const b of Array.from(out.body.querySelectorAll('br, div, p, li, ul, ol, h1, h2, h3, h4, h5, h6, blockquote, pre'))) {
    b.after(' ');
  }
  return (out.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Copies the visible nodes of `el` into `parent` (a node of a detached document), keeping the original elements and
 * attributes. Visibility follows the rules of `walk` and is read from the live element, not from the copy.
 */
function cloneVisible(el: Element, parent: Node, out: Document, inherited: boolean, isRoot: boolean): void {
  const tag = el.localName.toLowerCase();
  if (SKIP.has(tag) || hiddenByAttribute(el)) return;
  const cs = styleOf(el);
  if (cs?.display === 'none') return;
  const visibility = cs?.visibility ?? '';
  const visible = visibility === 'hidden' || visibility === 'collapse' ? false : visibility === 'visible' ? true : inherited;
  // A hidden element is dropped but its visible descendants stay, as in a text walk.
  let target: Node = parent;
  if (visible && !isRoot) {
    const copy = out.importNode(el, false);
    parent.appendChild(copy);
    target = copy;
  }
  for (const c of Array.from(el.childNodes)) {
    if (c.nodeType === 3) {
      if (visible) target.appendChild(out.importNode(c, false));
    } else if (c.nodeType === 1) {
      cloneVisible(c as Element, target, out, visible, false);
    }
  }
}

/** Visible content of the element (not the element itself) as sanitized HTML; structure is kept, links and sources are absolute. */
export function elementHtml(el: Element, baseUrl: string): string {
  // Detached, inert document: nothing runs and nothing is attached to the live page.
  const out = new DOMParser().parseFromString('<!doctype html><body>', 'text/html');
  cloneVisible(el, out.body, out, true, true);
  return sanitizeHtml(out.body.innerHTML, baseUrl);
}

/** Visible content of the element as Markdown: paragraphs, line breaks, headings, lists, absolute links, bold and italic. */
export function elementMarkdown(el: Element, baseUrl: string): string {
  const out = build(el, baseUrl);
  const html = sanitizeHtml(out.body.innerHTML, baseUrl);
  return createMarkdownContent(html, baseUrl).trim();
}
