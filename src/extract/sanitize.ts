const REMOVE = new Set([
  'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'script', 'style', 'noscript', 'template', 'base', 'link', 'meta',
  'form', 'input', 'button', 'select', 'textarea', 'option', 'optgroup', 'label', 'fieldset', 'legend', 'datalist', 'output', 'keygen',
]);
const LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const SRC_SCHEMES = new Set(['http:', 'https:']);
const URL_ATTRS = ['href', 'src', 'poster', 'cite', 'xlink:href'];

function absolute(value: string, base: string, schemes: Set<string>): string | null {
  try {
    const u = new URL(value.trim(), base);
    return schemes.has(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * Cleans an HTML fragment for sending as text. The fragment is parsed into a detached, inert document (no scripts run,
 * nothing loads), never into the live page. Returns the serialized body.
 */
export function sanitizeHtml(html: string, baseUrl: string): string {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html');
  for (const el of Array.from(doc.body.querySelectorAll('*'))) {
    if (!el.isConnected) continue;
    if (REMOVE.has(el.localName)) {
      el.remove();
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || name === 'style') {
        el.removeAttribute(attr.name);
      } else if (URL_ATTRS.includes(name)) {
        const href = absolute(attr.value, baseUrl, name === 'href' || name === 'xlink:href' || name === 'cite' ? LINK_SCHEMES : SRC_SCHEMES);
        if (href === null) el.removeAttribute(attr.name);
        else el.setAttribute(attr.name, href);
      } else if (name === 'srcset') {
        const parts = attr.value
          .split(',')
          .map((c) => c.trim().split(/\s+/))
          .map(([u, ...d]) => [u ? absolute(u, baseUrl, SRC_SCHEMES) : null, ...d] as const)
          .filter(([u]) => u !== null)
          .map(([u, ...d]) => [u, ...d].join(' '));
        if (parts.length === 0) el.removeAttribute(attr.name);
        else el.setAttribute(attr.name, parts.join(', '));
      } else if (name === 'action' || name === 'formaction') {
        el.removeAttribute(attr.name);
      }
    }
  }
  return doc.body.innerHTML.trim();
}
