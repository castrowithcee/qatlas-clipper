import type { FieldFormat } from '../config/schema';
import { elementHtml, elementMarkdown, elementText } from './element';

// A tag-like start or a character reference. Plain text such as "a < b" or "R&D" does not match.
const MARKUP = /<\/?[a-z][^>]*>|<!--|&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i;

/**
 * Converts an automatically read value into the field format. A value without markup is returned as is (also for
 * "html": special characters are not escaped, the content stays the same). Markup is parsed only in a detached, inert
 * document and reduced the same way as clicked elements.
 */
export function convertValue(value: string, format: FieldFormat, baseUrl: string): string {
  if (!MARKUP.test(value)) return value;
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${value}`, 'text/html');
  if (format === 'markdown') return elementMarkdown(doc.body, baseUrl);
  if (format === 'html') return elementHtml(doc.body, baseUrl);
  return elementText(doc.body);
}
