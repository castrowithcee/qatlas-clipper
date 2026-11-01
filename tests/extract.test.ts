// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { Field, Project, Trigger } from '../src/config/schema';
import { matchesTrigger, readPage, resolveField, resolveFields, selectProject } from '../src/extract';
import { resolveSchemaOrgPath, parseJsonLd } from '../src/extract/jsonld';

const URL_ = 'https://www.example.com/articles/1';

function html(body: string, head = ''): Document {
  return new DOMParser().parseFromString(`<!doctype html><html><head>${head}</head><body>${body}</body></html>`, 'text/html');
}
function ld(json: string): string {
  return `<script type="application/ld+json">${json}</script>`;
}
const page = (doc: Document, url = URL_) => readPage(url, doc);
const nodes = (...scripts: string[]) => parseJsonLd(scripts);

function project(id: string, triggers: Trigger[], extra: Partial<Project> = {}): Project {
  return { id, name: id, triggers, fields: [], siteMappings: {}, targets: [], ...extra };
}
function field(key: string, sources: Field['sources']): Field {
  return { key, label: key, required: false, sources };
}

describe('trigger matching', () => {
  const doc = html('', ld('{"@type":"Product","name":"P"}'));
  it('matches urlPrefix', () => {
    expect(matchesTrigger({ type: 'urlPrefix', value: 'https://www.example.com/articles' }, page(doc))).toBe(true);
    expect(matchesTrigger({ type: 'urlPrefix', value: 'https://example.com/' }, page(doc))).toBe(false);
  });
  it('matches regex and ignores an invalid one', () => {
    expect(matchesTrigger({ type: 'regex', pattern: 'articles/\\d+$' }, page(doc))).toBe(true);
    expect(matchesTrigger({ type: 'regex', pattern: 'nomatch' }, page(doc))).toBe(false);
    expect(matchesTrigger({ type: 'regex', pattern: '(' }, page(doc))).toBe(false);
  });
  it('matches schemaOrgType incl. full URL forms', () => {
    expect(matchesTrigger({ type: 'schemaOrgType', value: 'Product' }, page(doc))).toBe(true);
    expect(matchesTrigger({ type: 'schemaOrgType', value: 'https://schema.org/Product' }, page(doc))).toBe(true);
    expect(matchesTrigger({ type: 'schemaOrgType', value: 'Article' }, page(doc))).toBe(false);
  });
  it('first project in array order wins', () => {
    const a = project('a', [{ type: 'urlPrefix', value: 'https://www.example.com/' }]);
    const b = project('b', [{ type: 'regex', pattern: 'articles' }]);
    expect(selectProject([a, b], page(doc))?.id).toBe('a');
    expect(selectProject([b, a], page(doc))?.id).toBe('b');
    const c = project('c', [{ type: 'regex', pattern: '(' }, { type: 'schemaOrgType', value: 'Product' }]);
    expect(selectProject([project('none', []), c], page(doc))?.id).toBe('c');
    expect(selectProject([project('x', [{ type: 'urlPrefix', value: 'https://other.example/' }])], page(doc))).toBeUndefined();
  });
});

describe('schema.org paths', () => {
  it('reads a single object, trimmed, with numbers as text', () => {
    const n = nodes('{"@type":"Article","headline":"  Title ","wordCount":120}');
    expect(resolveSchemaOrgPath(n, 'Article.headline')).toBe('Title');
    expect(resolveSchemaOrgPath(n, 'Article.wordCount')).toBe('120');
    expect(resolveSchemaOrgPath(n, 'Product.headline')).toBe('');
  });
  it('yields name for objects and walks nested properties', () => {
    const n = nodes('{"@type":"Article","author":{"@type":"Person","name":"Jane Doe"},"publisher":{"name":"Org"}}');
    expect(resolveSchemaOrgPath(n, 'Article.author')).toBe('Jane Doe');
    expect(resolveSchemaOrgPath(n, 'Article.author.name')).toBe('Jane Doe');
    expect(resolveSchemaOrgPath(n, 'Article.publisher.name')).toBe('Org');
  });
  it('takes the first non-empty value of arrays', () => {
    const n = nodes('{"@type":"Article","author":[{"name":" "},{"name":"A"},{"name":"B"}],"keywords":["","k1","k2"]}');
    expect(resolveSchemaOrgPath(n, 'Article.author.name')).toBe('A');
    expect(resolveSchemaOrgPath(n, 'Article.author')).toBe('A');
    expect(resolveSchemaOrgPath(n, 'Article.keywords')).toBe('k1');
  });
  it('supports @graph', () => {
    const n = nodes('{"@context":"https://schema.org","@graph":[{"@type":"WebSite","name":"Site"},{"@type":"Article","headline":"H"}]}');
    expect(resolveSchemaOrgPath(n, 'Article.headline')).toBe('H');
    expect(resolveSchemaOrgPath(n, 'WebSite.name')).toBe('Site');
  });
  it('supports top-level arrays and several scripts', () => {
    const n = nodes('[{"@type":"Product","name":"P"},{"@type":"Article","headline":"H"}]', '{"@type":"Article","headline":"Second"}');
    expect(resolveSchemaOrgPath(n, 'Product.name')).toBe('P');
    expect(resolveSchemaOrgPath(n, 'Article.headline')).toBe('H');
  });
  it('supports multiple types and full-URL types', () => {
    const n = nodes('{"@type":["Thing","https://schema.org/NewsArticle"],"headline":"H"}', '{"@type":"http://schema.org/Product","name":"P"}');
    expect(resolveSchemaOrgPath(n, 'NewsArticle.headline')).toBe('H');
    expect(resolveSchemaOrgPath(n, 'Thing.headline')).toBe('H');
    expect(resolveSchemaOrgPath(n, 'Product.name')).toBe('P');
    expect(resolveSchemaOrgPath(n, 'https://schema.org/Product.name')).toBe('');
  });
  it('skips broken JSON and ignores prototype keys', () => {
    const n = nodes('{ broken', '', '"str"', '{"@type":"Article","headline":"H"}');
    expect(resolveSchemaOrgPath(n, 'Article.headline')).toBe('H');
    expect(resolveSchemaOrgPath(n, 'Article.constructor')).toBe('');
    expect(resolveSchemaOrgPath(n, 'Article..x')).toBe('');
  });
  it('collects scripts from the document', () => {
    const doc = html(ld('{"@type":"Article","headline":"H"}') + ld('{bad'));
    expect(resolveSchemaOrgPath(page(doc).nodes, 'Article.headline')).toBe('H');
  });
});

describe('field resolution', () => {
  const full = field('title', {
    schemaOrgPath: 'Article.headline',
    metaTag: { attribute: 'property', name: 'og:title' },
    manual: { type: 'text' },
  });
  const proj = project('p', [], { siteMappings: { 'example.com': { title: 'h1' } } });
  const meta = '<meta property="og:title" content=" Meta Title ">';
  const body = '<h1>  Selector \n Title </h1>';
  const json = ld('{"@type":"Article","headline":"LD Title"}');

  it('schema.org beats meta, selector and manual', () => {
    expect(resolveField(full, proj, page(html(body + json, meta)))).toEqual({ value: 'LD Title', source: 'schemaOrg' });
  });
  it('meta beats selector', () => {
    expect(resolveField(full, proj, page(html(body, meta)))).toEqual({ value: 'Meta Title', source: 'meta' });
  });
  it('selector beats manual, normalizing whitespace', () => {
    expect(resolveField(full, proj, page(html(body)))).toEqual({ value: 'Selector Title', source: 'selector' });
  });
  it('falls through empty values to manual', () => {
    const doc = html('<h1> </h1>' + ld('{"@type":"Article","headline":""}'), '<meta property="og:title" content="">');
    expect(resolveField(full, proj, page(doc))).toEqual({ value: '', source: 'manual' });
  });
  it('meta supports the name attribute and does not mix attributes', () => {
    const f = field('d', { metaTag: { attribute: 'name', name: 'description' } });
    expect(resolveField(f, proj, page(html('', '<meta name="description" content="Desc">'))).value).toBe('Desc');
    expect(resolveField(f, proj, page(html('', '<meta property="description" content="Desc">'))).source).toBe('manual');
  });
  it('selector domain: exact host, then without www; no other domains', () => {
    const f = field('title', {});
    const p = (domain: string) => project('p', [], { siteMappings: { [domain]: { title: 'h1' } } });
    const doc = html('<h1>T</h1>');
    expect(resolveField(f, p('www.example.com'), page(doc)).value).toBe('T');
    expect(resolveField(f, p('example.com'), page(doc)).value).toBe('T');
    expect(resolveField(f, p('example.com'), page(doc, 'https://example.com/x')).value).toBe('T');
    expect(resolveField(f, p('www.example.com'), page(doc, 'https://example.com/x')).value).toBe('');
    expect(resolveField(f, p('other.example'), page(doc)).value).toBe('');
    expect(resolveField(f, p('com'), page(doc)).value).toBe('');
  });
  it('uses the first selector match; invalid selector gives no value', () => {
    const f = field('title', {});
    const doc = html('<p class="a">One</p><p class="a">Two</p>');
    const withSel = (s: string) => project('p', [], { siteMappings: { 'example.com': { title: s } } });
    expect(resolveField(f, withSel('.a'), page(doc)).value).toBe('One');
    expect(resolveField(f, withSel('p[['), page(doc))).toEqual({ value: '', source: 'manual' });
  });
  it('resolveFields covers all fields', () => {
    const p = project('p', [], { fields: [full, field('x', { manual: { type: 'text' } })] });
    const r = resolveFields(p, page(html(body + json, meta)));
    expect(r).toEqual({ title: { value: 'LD Title', source: 'schemaOrg' }, x: { value: '', source: 'manual' } });
  });
});
