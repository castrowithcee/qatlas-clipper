// The full build carries the Markdown conversion; the base package only returns HTML.
import Defuddle, { createMarkdownContent } from 'defuddle/full';
import { contentFormatOf, type ContentFormat, type Project } from '../config/schema';
import { sanitizeHtml } from './sanitize';
import { matchProjects, readPage, resolveFields, nodeTypes, type FieldResult } from './index';

/** Upper bound for content in characters; longer content is cut and flagged. */
export const MAX_CONTENT_CHARS = 100_000;
export const TRUNCATION_MARKER = '\n\n[… truncated]';

export interface ReadResult {
  title: string;
  url: string;
  content: string;
  /** Format of `content`; `none` means no conversion ran and content is empty. */
  contentFormat: ContentFormat;
  contentTruncated: boolean;
  jsonLdTypes: string[];
  matchingProjects: { id: string; name: string }[];
  /** Project whose fields were resolved; null if none matches (or the requested one does not match). */
  selectedProjectId: string | null;
  fields: Record<string, FieldResult>;
}

function truncate(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  let end = max;
  // Do not split a surrogate pair.
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return { text: text.slice(0, end) + TRUNCATION_MARKER, truncated: true };
}

/**
 * Pure result building over a Document. Narrow reading for the project choice: an explicit projectId is used only
 * if that project matches the page (otherwise no fields); without projectId the first matching project is used.
 * Defuddle mutates the DOM it parses, so it runs on a clone and the live page stays untouched.
 */
export function buildReadResult(url: string, doc: Document, projects: Project[], projectId?: string, maxChars = MAX_CONTENT_CHARS): ReadResult {
  const page = readPage(url, doc);
  const matching = matchProjects(projects, page);
  const selected = projectId === undefined ? matching[0] : matching.find((p) => p.id === projectId);

  const contentFormat = selected ? contentFormatOf(selected) : 'markdown';
  // Defuddle returns cleaned HTML here. Markdown is converted from the sanitized HTML, because Defuddle's own
  // conversion passes elements such as iframes through as raw HTML. "none" skips the conversion entirely.
  const parsed = new Defuddle(doc.cloneNode(true) as Document, { url }).parse();
  const html = contentFormat === 'none' ? '' : sanitizeHtml(parsed.content ?? '', url);
  const raw = contentFormat === 'markdown' ? createMarkdownContent(html, url).trim() : html;
  const { text, truncated } = truncate(raw, maxChars);

  return {
    title: parsed.title || doc.title.trim(),
    url,
    content: text,
    contentFormat,
    contentTruncated: truncated,
    jsonLdTypes: [...new Set(page.nodes.flatMap((n) => nodeTypes(n)))],
    matchingProjects: matching.map((p) => ({ id: p.id, name: p.name })),
    selectedProjectId: selected?.id ?? null,
    fields: selected ? resolveFields(selected, page) : {},
  };
}
