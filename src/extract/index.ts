import type { Field, Project, Trigger } from '../config/schema';
import { collectJsonLdScripts, nodeTypes, normalizeSchemaType, parseJsonLd, resolveSchemaOrgPath, type JsonLdNode } from './jsonld';

export { collectJsonLdScripts, nodeTypes, normalizeSchemaType, parseJsonLd, resolveSchemaOrgPath } from './jsonld';
export type { JsonLdNode } from './jsonld';

export type FieldSource = 'schemaOrg' | 'meta' | 'selector' | 'manual';
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

export function matchesTrigger(trigger: Trigger, page: PageData): boolean {
  switch (trigger.type) {
    case 'urlPrefix':
      return page.url.startsWith(trigger.value);
    case 'regex':
      try {
        return new RegExp(trigger.pattern).test(page.url);
      } catch {
        return false;
      }
    case 'schemaOrgType': {
      const wanted = normalizeSchemaType(trigger.value);
      return page.nodes.some((n) => nodeTypes(n).includes(wanted));
    }
  }
}

/** First project in array order with at least one matching trigger. A project without triggers never matches. */
export function selectProject(projects: Project[], page: PageData): Project | undefined {
  return projects.find((p) => p.triggers.some((t) => matchesTrigger(t, page)));
}

/** Content of the first meta element with the given attribute value and a non-empty `content`. */
export function readMeta(doc: Document, attribute: 'name' | 'property', name: string): string {
  for (const el of doc.querySelectorAll('meta')) {
    if (el.getAttribute(attribute) !== name) continue;
    const content = (el.getAttribute('content') ?? '').trim();
    if (content) return content;
  }
  return '';
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

/** Whitespace-normalized text of the first match; an invalid selector yields ''. */
export function readSelector(doc: Document, selector: string): string {
  try {
    return (doc.querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

/** Fixed order: schema.org path, meta tag, site-mapping selector, manual input. First non-empty value wins. */
export function resolveField(field: Field, project: Pick<Project, 'siteMappings'>, page: PageData): FieldResult {
  const { schemaOrgPath, metaTag } = field.sources;
  if (schemaOrgPath) {
    const value = resolveSchemaOrgPath(page.nodes, schemaOrgPath);
    if (value) return { value, source: 'schemaOrg' };
  }
  if (metaTag) {
    const value = readMeta(page.doc, metaTag.attribute, metaTag.name);
    if (value) return { value, source: 'meta' };
  }
  const selector = findSelector(project.siteMappings, page.url, field.key);
  if (selector) {
    const value = readSelector(page.doc, selector);
    if (value) return { value, source: 'selector' };
  }
  return { value: '', source: 'manual' };
}

/** Field key -> result for every field of the project. */
export function resolveFields(project: Project, page: PageData): Record<string, FieldResult> {
  return Object.fromEntries(project.fields.map((f) => [f.key, resolveField(f, project, page)]));
}
