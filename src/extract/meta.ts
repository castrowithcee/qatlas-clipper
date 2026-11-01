/** Content of the first meta element with the given attribute value and a non-empty `content`. */
export function readMeta(doc: Document, attribute: 'name' | 'property', name: string): string {
  for (const el of doc.querySelectorAll('meta')) {
    if (el.getAttribute(attribute) !== name) continue;
    const content = (el.getAttribute('content') ?? '').trim();
    if (content) return content;
  }
  return '';
}
