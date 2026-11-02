import { fieldFormatOf, type Field, type FieldFormat, type Project } from '../config/schema';
import { elementMarkdown, elementText } from './element';
import { detectValue } from './detect';
import { readMeta } from './meta';
import { PAGE_TYPES } from './pageTypes';
import { collectJsonLdScripts, nodeTypes, normalizeSchemaType, parseJsonLd, resolveSchemaOrgPath, type JsonLdNode } from './jsonld';

export { DETECT_VALUES, type DetectValue } from './detect';
export { readMeta } from './meta';
export { PAGE_KINDS, PAGE_TYPES, type PageKind } from './pageTypes';
export { collectJsonLdScripts, nodeTypes, normalizeSchemaType, parseJsonLd, resolveSchemaOrgPath } from './jsonld';
export type { JsonLdNode } from './jsonld';

export type FieldSource = 'detect' | 'schemaOrg' | 'meta' | 'selector' | 'manual';
export type FieldResult = { value: string; source: FieldSource };

/** A page as seen by the extractor; JSON-LD is parsed once. */
export interface PageData {
  url: string;
  doc: Document;
  nodes: JsonLdNode[];
}

export function readPage(url: string, doc: Document): PageData {
  return { url, doc, nodes: parseJsonLd(collectJsonLdScripts(doc)) };
}

function hostMatches(url: string, domains: string[]): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return domains.some((d) => {
    const domain = d.toLowerCase();
    return host === domain || host.endsWith(`.${domain}`);
  });
}

/** All projects whose scope fits the page, in project order. */
export function matchProjects(projects: Project[], page: PageData): Project[] {
  return projects.filter(({ scope }) => {
    if (!scope.allSites && !hostMatches(page.url, scope.domains)) return false;
    // Both restrictions apply when both are set.
    if (scope.pageKind !== undefined) {
      const wanted: readonly string[] = PAGE_TYPES[scope.pageKind];
      if (!page.nodes.some((n) => nodeTypes(n).some((t) => wanted.includes(t)))) return false;
    }
    if (scope.pageType !== undefined) {
      const wanted = normalizeSchemaType(scope.pageType);
      if (!page.nodes.some((n) => nodeTypes(n).includes(wanted))) return false;
    }
    return true;
  });
}

/**
 * Selector for the URL's domain. Narrow reading: exact hostname (case-insensitive), then the hostname without
 * one leading "www."; mapping keys are not stripped and no parent-domain matching is done.
 */
export function findSelector(siteMappings: Project['siteMappings'], url: string, fieldKey: string): string | undefined {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  const candidates = host.startsWith('www.') ? [host, host.slice(4)] : [host];
  for (const candidate of candidates) {
    for (const [domain, map] of Object.entries(siteMappings)) {
      if (domain.toLowerCase() === candidate && Object.hasOwn(map, fieldKey)) return map[fieldKey];
    }
  }
  return undefined;
}

/**
 * Visible content of the first match: one line for "text", structured Markdown for "markdown".
 * An invalid selector or no match yields ''.
 */
export function readSelector(doc: Document, selector: string, format: FieldFormat = 'text', baseUrl: string = doc.URL): string {
  let el: Element | null;
  try {
    el = doc.querySelector(selector);
  } catch {
    return '';
  }
  if (!el) return '';
  return format === 'markdown' ? elementMarkdown(el, baseUrl) : elementText(el);
}

/**
 * Fixed order: site-mapping selector, detect value, own schema.org path, own meta tag, manual input.
 * The selector comes first because a user who clicked an element is correcting the automatic detection.
 * First non-empty value wins.
 */
export function resolveField(field: Field, project: Pick<Project, 'siteMappings'>, page: PageData): FieldResult {
  const { detect, schemaOrgPath, metaTag } = field.sources;
  const selector = findSelector(project.siteMappings, page.url, field.key);
  if (selector) {
    const value = readSelector(page.doc, selector, fieldFormatOf(field), page.url);
    if (value) return { value, source: 'selector' };
  }
  if (detect) {
    const value = detectValue(detect, page);
    if (value) return { value, source: 'detect' };
  }
  if (schemaOrgPath) {
    const value = resolveSchemaOrgPath(page.nodes, schemaOrgPath);
    if (value) return { value, source: 'schemaOrg' };
  }
  if (metaTag) {
    const value = readMeta(page.doc, metaTag.attribute, metaTag.name);
    if (value) return { value, source: 'meta' };
  }
  return { value: '', source: 'manual' };
}

/** Field key -> result for every field of the project. */
export function resolveFields(project: Project, page: PageData): Record<string, FieldResult> {
  return Object.fromEntries(project.fields.map((f) => [f.key, resolveField(f, project, page)]));
}
