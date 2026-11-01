import Defuddle from 'defuddle';
import type { Project } from '../config/schema';
import { matchProjects, readPage, resolveFields, nodeTypes, type FieldResult } from './index';

/** Upper bound for contentMarkdown in characters; longer content is cut and flagged. */
export const MAX_CONTENT_CHARS = 100_000;
export const TRUNCATION_MARKER = '\n\n[… truncated]';

export interface ReadResult {
  title: string;
  url: string;
  contentMarkdown: string;
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

  const parsed = new Defuddle(doc.cloneNode(true) as Document, { url, markdown: true }).parse();
  const { text, truncated } = truncate(parsed.content ?? '', maxChars);

  return {
    title: parsed.title || doc.title.trim(),
    url,
    contentMarkdown: text,
    contentTruncated: truncated,
    jsonLdTypes: [...new Set(page.nodes.flatMap((n) => nodeTypes(n)))],
    matchingProjects: matching.map((p) => ({ id: p.id, name: p.name })),
    selectedProjectId: selected?.id ?? null,
    fields: selected ? resolveFields(selected, page) : {},
  };
}
