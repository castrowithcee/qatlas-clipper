// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { Field, Project, Scope } from '../src/config/schema';
import { matchProjects, readPage, resolveField, resolveFields } from '../src/extract';
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

function project(id: string, scope: Scope, extra: Partial<Project> = {}): Project {
  return { id, name: id, scope, fields: [], siteMappings: {}, targets: [], ...extra };
}
function field(key: string, sources: Field['sources']): Field {
  return { key, label: key, required: false, sources };
}

describe('scope matching', () => {
  const all: Scope = { allSites: true, domains: [] };
  const on = (domain: string, pageType?: string): Scope => ({ allSites: false, domains: [domain], ...(pageType ? { pageType } : {}) });
  const ids = (projects: Project[], doc: Document, url = URL_) => matchProjects(projects, page(doc, url)).map((p) => p.id);
  const plain = html('');

  it('matches a domain, its subdomains and ignores host case', () => {
    const p = [project('a', on('example.com'))];
    for (const url of ['https://example.com/', 'https://www.example.com/x', 'https://jobs.example.com/', 'https://EXAMPLE.com:8080/p?q=1']) {
      expect(ids(p, plain, url)).toEqual(['a']);
    }
    for (const url of ['https://notexample.com/', 'https://example.com.evil.test/', 'https://example.org/', 'not a url']) {
      expect(ids(p, plain, url)).toEqual([]);
    }
  });

  it('restricts by page type, also in @graph and type arrays', () => {
    const p = [project('p', { allSites: true, domains: [], pageType: 'Product' })];
    expect(ids(p, html('', ld('{"@type":"Product"}')))).toEqual(['p']);
    expect(ids(p, html('', ld('{"@type":"https://schema.org/Product"}')))).toEqual(['p']);
    expect(ids(p, html('', ld('{"@graph":[{"@type":"WebPage"},{"@type":"Product"}]}')))).toEqual(['p']);
    expect(ids(p, html('', ld('{"@type":["Thing","Product"]}')))).toEqual(['p']);
    expect(ids(p, html('', ld('{"@type":"Article"}')))).toEqual([]);
    expect(ids(p, plain)).toEqual([]);
  });

  it('allSites without page type matches everywhere', () => {
    expect(ids([project('a', all)], plain, 'https://other.example/')).toEqual(['a']);
  });

  it('combines domain and page type', () => {
    const p = [project('a', on('example.com', 'Product'))];
    const prod = html('', ld('{"@type":"Product"}'));
    expect(ids(p, prod)).toEqual(['a']);
    expect(ids(p, prod, 'https://other.example/')).toEqual([]);
    expect(ids(p, plain)).toEqual([]);
  });

  it('returns all matching projects in project order', () => {
    const doc = html('', ld('{"@type":"Product"}'));
    const a = project('a', on('example.com'));
    const b = project('b', all);
    const c = project('c', on('other.example'));
    const d = project('d', { allSites: true, domains: [], pageType: 'Product' });
    expect(ids([a, b, c, d], doc)).toEqual(['a', 'b', 'd']);
    expect(ids([d, c, b, a], doc)).toEqual(['d', 'b', 'a']);
    expect(ids([], doc)).toEqual([]);
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
  // Format text keeps these source-order tests independent of the Markdown default for clicked elements.
  const full: Field = {
    ...field('title', {
      schemaOrgPath: 'Article.headline',
      metaTag: { attribute: 'property', name: 'og:title' },
      manual: { type: 'text' },
    }),
    format: 'text',
  };
  const proj = project('p', { allSites: true, domains: [] }, { siteMappings: { 'example.com': { title: 'h1' } } });
  const meta = '<meta property="og:title" content=" Meta Title ">';
  const body = '<h1>  Selector \n Title </h1>';
  const json = ld('{"@type":"Article","headline":"LD Title"}');

  it('selector beats schema.org path, meta and manual', () => {
    expect(resolveField(full, proj, page(html(body + json, meta)))).toEqual({ value: 'Selector Title', source: 'selector' });
  });
  it('schema.org path beats meta', () => {
    expect(resolveField(full, proj, page(html(json, meta)))).toEqual({ value: 'LD Title', source: 'schemaOrg' });
  });
  it('meta beats manual', () => {
    expect(resolveField(full, proj, page(html('', meta)))).toEqual({ value: 'Meta Title', source: 'meta' });
  });
  it('selector normalizes whitespace', () => {
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
    const f: Field = { ...field('title', {}), format: 'text' };
    const p = (domain: string) => project('p', { allSites: true, domains: [] }, { siteMappings: { [domain]: { title: 'h1' } } });
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
    const withSel = (s: string) => project('p', { allSites: true, domains: [] }, { siteMappings: { 'example.com': { title: s } } });
    expect(resolveField(f, withSel('.a'), page(doc)).value).toBe('One');
    expect(resolveField(f, withSel('p[['), page(doc))).toEqual({ value: '', source: 'manual' });
  });
  it('resolveFields covers all fields', () => {
    const p = project('p', { allSites: true, domains: [] }, { fields: [full, field('x', { manual: { type: 'text' } })] });
    const r = resolveFields(p, page(html(body + json, meta)));
    expect(r).toEqual({ title: { value: 'LD Title', source: 'schemaOrg' }, x: { value: '', source: 'manual' } });
  });
});

describe('field format of clicked elements', () => {
  const CONTACT =
    '<div id="c"><strong>Ansprechpartner</strong><br>Erika Beispiel<br>Leitung Einkauf<br><a href="mailto:info@example.com">info@example.com</a></div>';
  const pick = (body: string, format?: Field['format'], sel = '#c') => {
    const f: Field = { ...field('f', {}), ...(format ? { format } : {}) };
    const p = project('p', { allSites: true, domains: [] }, { siteMappings: { 'example.com': { f: sel } } });
    return resolveField(f, p, page(html(body))).value;
  };

  it('treats elements with a block display as paragraphs', () => {
    const html =
      '<div id="c"><span style="display:block">Erika Beispiel</span><span style="display:block">Leitung Einkauf</span><span style="display:inline-block">A</span><span>B</span></div>';
    expect(pick(html, 'markdown').split('\n').filter(Boolean)).toEqual(['Erika Beispiel', 'Leitung Einkauf', 'AB']);
    expect(pick(html, 'text')).toBe('Erika Beispiel Leitung Einkauf AB');
  });

  it('renders a contact block as Markdown lines and as one text line', () => {
    const md = pick(CONTACT, 'markdown').split('\n').map((l) => l.trim()).filter(Boolean);
    expect(md).toEqual(['**Ansprechpartner**', 'Erika Beispiel', 'Leitung Einkauf', '[info@example.com](mailto:info@example.com)']);
    expect(pick(CONTACT, 'text')).toBe('Ansprechpartner Erika Beispiel Leitung Einkauf info@example.com');
  });

  it('treats a missing format as Markdown', () => {
    expect(pick(CONTACT)).toBe(pick(CONTACT, 'markdown'));
  });

  it('takes bold and italic from inline styles, also with block elements', () => {
    const body =
      '<div id="c"><div><span style="font-weight:700">Ansprechpartner</span></div><div>Erika <span style="font-style:italic">Beispiel</span></div><div>Leitung Einkauf</div></div>';
    const md = pick(body, 'markdown').split('\n').map((l) => l.trim()).filter(Boolean);
    expect(md).toEqual(['**Ansprechpartner**', 'Erika *Beispiel*', 'Leitung Einkauf']);
  });

  it('omits hidden text in both formats', () => {
    const hidden = [
      '<span style="display:none">SECRET</span>',
      '<span style="visibility:hidden">SECRET</span>',
      '<span hidden>SECRET</span>',
      '<span aria-hidden="true">SECRET</span>',
      '<script>SECRET</script><style>SECRET</style><template>SECRET</template><noscript>SECRET</noscript><iframe>SECRET</iframe>',
    ];
    for (const h of hidden) {
      const body = `<div id="c">Visible ${h} text</div>`;
      expect(pick(body, 'markdown')).toBe('Visible text');
      expect(pick(body, 'text')).toBe('Visible text');
    }
  });

  it('shows a visible child of a hidden-visibility parent', () => {
    const body = '<div id="c" style="visibility:hidden">A<span style="visibility:visible">B</span></div>';
    expect(pick(body, 'text')).toBe('B');
  });

  it('maps headings, lists and absolute links', () => {
    const body = '<div id="c"><h2>Title</h2><p>See <a href="/docs/a">the docs</a> or <a href="javascript:alert(1)">bad</a>.</p><ul><li>One</li><li>Two</li></ul></div>';
    const md = pick(body, 'markdown');
    expect(md).toContain('## Title');
    expect(md).toContain('[the docs](https://www.example.com/docs/a)');
    expect(md).not.toContain('javascript');
    expect(md).toContain('bad.');
    expect(md).toMatch(/-\s+One\n-\s+Two/);
    expect(pick(body, 'text')).toBe('Title See the docs or bad. One Two');
  });

  it('keeps detect, schema.org and meta values unchanged as text', () => {
    const json = ld('{"@type":"Article","headline":"A *b* [c](d)"}');
    const meta = '<meta name="description" content="**bold** text">';
    const doc = html(json, meta);
    for (const format of ['markdown', 'text'] as const) {
      const proj = project('p', { allSites: true, domains: [] });
      const g = (sources: Field['sources']) => resolveField({ ...field('f', sources), format }, proj, page(doc)).value;
      expect(g({ schemaOrgPath: 'Article.headline' })).toBe('A *b* [c](d)');
      expect(g({ metaTag: { attribute: 'name', name: 'description' } })).toBe('**bold** text');
    }
  });
});
