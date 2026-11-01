export type JsonLdNode = Record<string, unknown>;

const SCHEMA_ORG_PREFIX = /^https?:\/\/schema\.org\//;

/** Narrow reading: only the plain name and the http(s)://schema.org/ forms are equal. */
export function normalizeSchemaType(type: string): string {
  return type.trim().replace(SCHEMA_ORG_PREFIX, '');
}

export function isObject(v: unknown): v is JsonLdNode {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Text contents of all `script[type="application/ld+json"]` elements. */
export function collectJsonLdScripts(doc: Document): string[] {
  return Array.from(doc.querySelectorAll('script[type="application/ld+json"]'), (el) => el.textContent ?? '');
}

function flatten(value: unknown, out: JsonLdNode[], depth: number): void {
  if (depth > 8) return;
  if (Array.isArray(value)) {
    for (const item of value) flatten(item, out, depth + 1);
    return;
  }
  if (!isObject(value)) return;
  out.push(value);
  // Only the top level and @graph members are nodes; nested objects are reached via property paths.
  if (Object.hasOwn(value, '@graph')) flatten(value['@graph'], out, depth + 1);
}

/** Parse script contents into top-level nodes (single object, array, @graph). Broken JSON is skipped. */
export function parseJsonLd(scripts: string[]): JsonLdNode[] {
  const nodes: JsonLdNode[] = [];
  for (const text of scripts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    flatten(parsed, nodes, 0);
  }
  return nodes;
}

/** Normalized `@type` values of a node (string or array). */
export function nodeTypes(node: JsonLdNode): string[] {
  const t = Object.hasOwn(node, '@type') ? node['@type'] : undefined;
  const list = Array.isArray(t) ? t : [t];
  return list.filter((x): x is string => typeof x === 'string').map(normalizeSchemaType);
}

export function toText(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

/**
 * Text at a property path. A final object yields its first non-empty `leaf` property (default `name`);
 * an array takes its first non-empty entry; deeper objects are not descended further.
 */
export function readProperty(value: unknown, props: string[], leaf: string[] = ['name']): string {
  const [head, ...rest] = props;
  if (Array.isArray(value)) {
    for (const item of value) {
      const r = readProperty(item, props, leaf);
      if (r) return r;
    }
    return '';
  }
  if (head === undefined) {
    if (isObject(value)) {
      for (const key of leaf) {
        const v = Object.hasOwn(value, key) ? value[key] : undefined;
        const text = Array.isArray(v) ? (v.map(toText).find(Boolean) ?? '') : toText(v);
        if (text) return text;
      }
      return '';
    }
    return toText(value);
  }
  if (!isObject(value) || !Object.hasOwn(value, head)) return '';
  return readProperty(value[head], rest, leaf);
}

/** Resolve `Type.property.property` against nodes. The first node of that type yielding a value wins. */
export function resolveSchemaOrgPath(nodes: JsonLdNode[], path: string): string {
  const [type, ...props] = path.split('.').map((s) => s.trim());
  if (!type || props.some((p) => !p)) return '';
  const wanted = normalizeSchemaType(type);
  for (const node of nodes) {
    if (!nodeTypes(node).includes(wanted)) continue;
    const r = readProperty(node, props);
    if (r) return r;
  }
  return '';
}
