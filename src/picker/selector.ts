export type SelectorResult =
  | { unique: true; selector: string }
  | { unique: false; selector: null; reason: string };

/** Maximum number of ancestor levels searched for a stable anchor. */
export const MAX_ANCESTOR_DEPTH = 5;

const PREFERRED_DATA_ATTRS = ['data-testid', 'data-test', 'data-qa', 'data-field'];

/**
 * Heuristic: true if a token (id, class or attribute value) looks machine-generated.
 * Deliberately conservative towards "generated": a skipped stable token only costs
 * a less specific selector, while a kept generated token breaks on the next build.
 */
export function isGeneratedToken(token: string): boolean {
  if (token === '') return true;
  if (/^:.*:$/.test(token)) return true; // React useId, e.g. ":r0:"
  if (/^ember\d+/i.test(token)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) return true;
  if (/^(css|sc|jsx|svelte|emotion|styled|makeStyles|Mui\w*-\w+)-/i.test(token) && /[0-9]/.test(token)) return true;
  if (/^(css|sc|svelte)-[a-z0-9]+$/i.test(token)) return true;
  if (/\d{4,}/.test(token)) return true; // long digit runs
  if (/[0-9a-f]{8,}/i.test(token) && /\d/.test(token)) return true; // long hex tokens
  if (/__[A-Za-z0-9_-]{5}\b/.test(token) && /_[A-Za-z0-9]+__/.test(token)) return true; // CSS modules
  if (/__[A-Za-z0-9_-]*\d[A-Za-z0-9_-]*$/.test(token)) return true;
  // Hash-like segment: mixes letters and digits, at least 5 chars, e.g. "a1b2c3".
  return token.split(/[-_]/).some(
    (part) => part.length >= 5 && /\d/.test(part) && /[a-z]/i.test(part),
  );
}

const esc = (v: string): string => CSS.escape(v);

const attrSelector = (name: string, value: string): string => `[${name}="${esc(value)}"]`;

function idSelector(el: Element): string[] {
  const id = el.getAttribute('id');
  return id && !isGeneratedToken(id) ? [`#${esc(id)}`] : [];
}

function dataSelectors(el: Element): string[] {
  const stable = Array.from(el.attributes).filter(
    (a) => a.name.startsWith('data-') && a.value !== '' && a.value.length <= 64 && !isGeneratedToken(a.value),
  );
  const rank = (name: string): number => {
    const i = PREFERRED_DATA_ATTRS.indexOf(name);
    return i === -1 ? PREFERRED_DATA_ATTRS.length : i;
  };
  return stable.sort((a, b) => rank(a.name) - rank(b.name)).map((a) => attrSelector(a.name, a.value));
}

function stableClasses(el: Element): string[] {
  return Array.from(el.classList).filter((c) => !isGeneratedToken(c));
}

function classSelectors(el: Element): string[] {
  const classes = stableClasses(el);
  const tag = el.localName;
  const out: string[] = [];
  for (const c of classes) out.push(`.${esc(c)}`);
  for (const c of classes) out.push(`${tag}.${esc(c)}`);
  if (classes.length > 1) out.push(`${tag}${classes.map((c) => `.${esc(c)}`).join('')}`);
  return out;
}

/** Own selectors in priority order: id > data attribute > stable classes. */
function ownSelectors(el: Element): string[] {
  const list = [...idSelector(el), ...dataSelectors(el), ...classSelectors(el)];
  const doc = el.ownerDocument;
  if (el === doc.documentElement || el === doc.body) list.push(el.localName);
  return list;
}

/** Anchors on ancestors must be identifying on their own, so a bare tag does not count. */
function anchorSelectors(el: Element): string[] {
  return [...idSelector(el), ...dataSelectors(el), ...classSelectors(el).filter((s) => s.includes('.'))];
}

function matchesOnly(root: Document, selector: string, el: Element): boolean {
  try {
    const found = root.querySelectorAll(selector);
    return found.length === 1 && found[0] === el;
  } catch {
    return false;
  }
}

/**
 * Returns a stable CSS selector that matches exactly `el` in its document.
 * Never uses positional pseudo-classes; if no stable unique selector exists the
 * result is flagged `unique: false` and carries no selector.
 */
export function generateSelector(el: Element): SelectorResult {
  const root = el.ownerDocument;
  const own = ownSelectors(el);

  for (const sel of own) {
    if (matchesOnly(root, sel, el)) return { unique: true, selector: sel };
  }

  // Own selectors plus the bare tag, combined with a stable ancestor.
  const tails = [...own, el.localName];
  let ancestor = el.parentElement;
  for (let depth = 1; ancestor && depth <= MAX_ANCESTOR_DEPTH; depth++) {
    const combinator = depth === 1 ? ' > ' : ' ';
    for (const anchor of anchorSelectors(ancestor)) {
      for (const tail of tails) {
        const sel = `${anchor}${combinator}${tail}`;
        if (matchesOnly(root, sel, el)) return { unique: true, selector: sel };
      }
    }
    ancestor = ancestor.parentElement;
  }

  return {
    unique: false,
    selector: null,
    reason: `no unique stable selector within ${MAX_ANCESTOR_DEPTH} ancestor levels`,
  };
}
