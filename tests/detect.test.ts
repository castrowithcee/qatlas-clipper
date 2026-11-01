// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config';
import type { Field, Project, Scope } from '../src/config/schema';
import { DETECT_VALUES, matchProjects, readPage, resolveField, type DetectValue } from '../src/extract';

const URL_ = 'https://www.example.com/items/1';

function html(body: string, head = ''): Document {
  return new DOMParser().parseFromString(`<!doctype html><html><head>${head}</head><body>${body}</body></html>`, 'text/html');
}
const ld = (json: unknown) => `<script type="application/ld+json">${typeof json === 'string' ? json : JSON.stringify(json)}</script>`;
const page = (doc: Document, url = URL_) => readPage(url, doc);
const project = (siteMappings: Project['siteMappings'] = {}): Pick<Project, 'siteMappings'> => ({ siteMappings });
const field = (sources: Field['sources']): Field => ({ key: 'f', label: 'f', required: false, sources });
const detect = (value: DetectValue, doc: Document, url = URL_) => resolveField(field({ detect: value }), project(), page(doc, url));

describe('detect values', () => {
  // value -> [JSON-LD head, expected], [meta head, expected]
  const cases: Record<DetectValue, { ld: [unknown, string]; meta: [string, string] }> = {
    title: { ld: [{ '@type': 'Article', headline: 'LD Title' }, 'LD Title'], meta: ['<meta property="og:title" content="Meta Title">', 'Meta Title'] },
    description: {
      ld: [{ '@type': 'Product', name: 'P', description: 'LD Desc' }, 'LD Desc'],
      meta: ['<meta name="description" content="Meta Desc">', 'Meta Desc'],
    },
    author: {
      ld: [{ '@type': 'BlogPosting', author: [{ '@type': 'Person', name: 'Example Author' }] }, 'Example Author'],
      meta: ['<meta name="author" content="Meta Author">', 'Meta Author'],
    },
    published: {
      ld: [{ '@type': 'NewsArticle', datePublished: '2024-05-01T10:00:00+02:00' }, '2024-05-01T10:00:00+02:00'],
      meta: ['<meta property="article:published_time" content="2024-05-01T08:00:00Z">', '2024-05-01T08:00:00Z'],
    },
    price: {
      ld: [{ '@type': 'Product', offers: { '@type': 'Offer', price: 19.99, priceCurrency: 'EUR' } }, '19.99 EUR'],
      meta: ['<meta property="product:price:amount" content="12.50"><meta property="product:price:currency" content="USD">', '12.50 USD'],
    },
    // No common meta tag for company; nearest candidate is the Open Graph product brand.
    company: {
      ld: [{ '@type': 'JobPosting', hiringOrganization: { '@type': 'Organization', name: 'Example Corp' } }, 'Example Corp'],
      meta: ['<meta property="product:brand" content="Example Brand">', 'Example Brand'],
    },
    // No common meta tag for location; nearest candidate is geo.placename.
    location: {
      ld: [
        { '@type': 'JobPosting', jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: 'Springfield', addressRegion: 'XY', addressCountry: 'US' } } },
        'Springfield, XY, US',
      ],
      meta: ['<meta name="geo.placename" content="Springfield">', 'Springfield'],
    },
    image: {
      ld: [{ '@type': 'Product', image: ['/img/a.png'] }, 'https://www.example.com/img/a.png'],
      meta: ['<meta property="og:image" content="//cdn.example.com/b.png">', 'https://cdn.example.com/b.png'],
    },
    siteName: {
      ld: [{ '@type': 'WebSite', name: 'Example Site' }, 'Example Site'],
      meta: ['<meta property="og:site_name" content="Meta Site">', 'Meta Site'],
    },
  };

  it('covers every detect value', () => {
    expect(Object.keys(cases).sort()).toEqual([...DETECT_VALUES].sort());
  });

  for (const value of DETECT_VALUES) {
    it(`${value}: JSON-LD, meta tags and empty page`, () => {
      const c = cases[value];
      expect(detect(value, html(ld(c.ld[0])))).toEqual({ value: c.ld[1], source: 'detect' });
      expect(detect(value, html('', c.meta[0]))).toEqual({ value: c.meta[1], source: 'detect' });
      expect(detect(value, html(''))).toEqual({ value: '', source: 'manual' });
    });
  }

  it('title falls back to the document title; JSON-LD wins over meta', () => {
    expect(detect('title', html('', '<title> Doc \n Title </title>')).value).toBe('Doc Title');
    const head = '<meta property="og:title" content="OG"><meta name="twitter:title" content="TW"><title>Doc</title>';
    expect(detect('title', html('', head)).value).toBe('OG');
    expect(detect('title', html('', '<meta name="twitter:title" content="TW"><title>Doc</title>')).value).toBe('TW');
    expect(detect('title', html(ld({ '@type': 'Product', name: 'LD' }), head)).value).toBe('LD');
  });

  it('only the main type describes the subject', () => {
    const doc = html(ld({ '@graph': [{ '@type': 'WebPage', name: 'Page' }, { '@type': 'Article', headline: 'Main' }] }));
    expect(detect('title', doc).value).toBe('Main');
    expect(detect('title', html(ld({ '@type': 'WebPage', name: 'Page' }))).value).toBe('');
  });

  it('price uses the lowest price of an aggregate offer and omits a missing currency', () => {
    expect(detect('price', html(ld({ '@type': 'Product', offers: [{ '@type': 'AggregateOffer', lowPrice: '5', priceCurrency: 'CHF' }] }))).value).toBe('5 CHF');
    expect(detect('price', html(ld({ '@type': 'Product', offers: { price: '0' } }))).value).toBe('0');
  });

  it('company order: hiringOrganization, brand, publisher, then own business name', () => {
    const brandAndPublisher = { '@type': 'Product', brand: { name: 'Brand' }, publisher: { name: 'Pub' } };
    expect(detect('company', html(ld(brandAndPublisher))).value).toBe('Brand');
    expect(detect('company', html(ld({ '@type': 'Article', publisher: { name: 'Pub' } }))).value).toBe('Pub');
    expect(detect('company', html(ld({ '@type': 'Restaurant', name: 'Example Diner' }))).value).toBe('Example Diner');
    expect(detect('company', html(ld({ '@type': 'Article', name: 'Not a company' }))).value).toBe('');
  });

  it('location falls back to the place name', () => {
    expect(detect('location', html(ld({ '@type': 'Event', location: { '@type': 'Place', name: 'Example Hall' } }))).value).toBe('Example Hall');
    expect(detect('location', html(ld({ '@type': 'Event', location: 'Example Hall' }))).value).toBe('Example Hall');
  });

  it('image is an absolute http(s) URL; other schemes are dropped', () => {
    const rel = html(ld({ '@type': 'Article', image: { '@type': 'ImageObject', url: 'pics/x.jpg' } }));
    expect(detect('image', rel, 'https://example.com/a/b').value).toBe('https://example.com/a/pics/x.jpg');
    expect(detect('image', html('', '<meta property="og:image" content="javascript:alert(1)">')).value).toBe('');
    expect(detect('image', html(ld({ '@type': 'Article', image: 'data:image/png;base64,AAAA' }), '<meta property="og:image" content="/ok.png">')).value).toBe(
      'https://www.example.com/ok.png',
    );
  });

  it('siteName uses og:site_name only as the last candidate', () => {
    const og = '<meta property="og:site_name" content="OG Site">';
    expect(detect('siteName', html('', '<meta name="application-name" content="App">' + og)).value).toBe('App');
    expect(detect('siteName', html(ld({ '@type': 'WebSite', name: 'LD Site' }), og)).value).toBe('LD Site');
  });

  it('survives broken and foreign JSON-LD structures', () => {
    const doc = html(ld('{ broken') + ld('[null, 1, "x", [], {"@type": 5}]') + ld({ '@type': 'Article', author: 7, image: { url: {} }, offers: 'x' }));
    for (const v of DETECT_VALUES) expect(() => detect(v, doc)).not.toThrow();
  });
});

describe('source order', () => {
  const doc = html('<h1>Clicked</h1>' + ld({ '@type': 'Article', headline: 'Detected', author: { name: 'Own Path' } }), '<meta property="og:title" content="Own Meta">');
  const sources: Field['sources'] = {
    detect: 'title',
    schemaOrgPath: 'Article.author.name',
    metaTag: { attribute: 'property', name: 'og:title' },
    manual: { type: 'text' },
  };
  const mapped = project({ 'example.com': { f: 'h1' } });

  it('click mapping beats detect value', () => {
    expect(resolveField(field(sources), mapped, page(doc))).toEqual({ value: 'Clicked', source: 'selector' });
  });
  it('detect value beats own path and meta tag', () => {
    expect(resolveField(field(sources), project(), page(doc))).toEqual({ value: 'Detected', source: 'detect' });
  });
  it('own path beats meta tag, meta tag beats manual', () => {
    expect(resolveField(field({ ...sources, detect: undefined }), project(), page(doc))).toEqual({ value: 'Own Path', source: 'schemaOrg' });
    expect(resolveField(field({ metaTag: sources.metaTag }), project(), page(doc))).toEqual({ value: 'Own Meta', source: 'meta' });
  });
  it('an empty click mapping falls through to the detect value', () => {
    expect(resolveField(field(sources), project({ 'example.com': { f: '.missing' } }), page(doc)).source).toBe('detect');
  });
  it('no hit leaves manual input', () => {
    expect(resolveField(field(sources), mapped, page(html('')))).toEqual({ value: '', source: 'manual' });
  });
});

describe('page kinds', () => {
  const ids = (scope: Partial<Scope>, doc: Document) =>
    matchProjects([{ id: 'p', name: 'p', scope: { allSites: true, domains: [], ...scope }, fields: [], siteMappings: {}, targets: [] }], page(doc)).length;

  it('article matches Article, NewsArticle and BlogPosting', () => {
    for (const t of ['Article', 'NewsArticle', 'BlogPosting']) expect(ids({ pageKind: 'article' }, html(ld({ '@type': t })))).toBe(1);
    expect(ids({ pageKind: 'article' }, html(ld({ '@type': 'Product' })))).toBe(0);
  });
  it('jobPosting matches JobPosting only', () => {
    expect(ids({ pageKind: 'jobPosting' }, html(ld({ '@type': 'JobPosting' })))).toBe(1);
    expect(ids({ pageKind: 'jobPosting' }, html(ld({ '@type': 'Article' })))).toBe(0);
  });
  it('matches in @graph and type arrays; subtype lists cover the other kinds', () => {
    expect(ids({ pageKind: 'event' }, html(ld({ '@graph': [{ '@type': ['Thing', 'MusicEvent'] }] })))).toBe(1);
    expect(ids({ pageKind: 'localBusiness' }, html(ld({ '@type': 'Restaurant' })))).toBe(1);
    expect(ids({ pageKind: 'recipe' }, html(ld({ '@type': 'Recipe' })))).toBe(1);
    expect(ids({ pageKind: 'product' }, html(ld({ '@type': 'https://schema.org/ProductGroup' })))).toBe(1);
  });
  it('a custom schema.org type still works and both restrictions apply together', () => {
    expect(ids({ pageType: 'Dataset' }, html(ld({ '@type': 'Dataset' })))).toBe(1);
    expect(ids({ pageType: 'Dataset' }, html(ld({ '@type': 'Article' })))).toBe(0);
    expect(ids({ pageKind: 'article', pageType: 'Dataset' }, html(ld({ '@type': 'Article' })))).toBe(0);
    expect(ids({ pageKind: 'article', pageType: 'Dataset' }, html(ld([{ '@type': 'Article' }, { '@type': 'Dataset' }])))).toBe(1);
  });
});

describe('config validation', () => {
  const cfg = (scope: unknown, sources: unknown) => ({
    schemaVersion: 1,
    projects: [{ id: 'p', name: 'p', scope, fields: [{ key: 'f', label: 'f', required: false, sources }], siteMappings: {}, targets: [] }],
  });
  const all = { allSites: true, domains: [] };

  it('accepts every detect value and page kind, next to technical sources and a custom type', () => {
    for (const d of DETECT_VALUES) expect(() => parseConfig(cfg(all, { detect: d }))).not.toThrow();
    for (const k of ['product', 'jobPosting', 'article', 'event', 'recipe', 'localBusiness']) {
      expect(() => parseConfig(cfg({ ...all, pageKind: k, pageType: 'Dataset' }, { detect: 'title', schemaOrgPath: 'A.b', manual: { type: 'text' } }))).not.toThrow();
    }
  });
  it('rejects unknown detect values and page kinds with their path', () => {
    expect(() => parseConfig(cfg(all, { detect: 'color' }))).toThrow(/projects\[0\]\.fields\[0\]\.sources\.detect/);
    expect(() => parseConfig(cfg({ ...all, pageKind: 'Product' }, {}))).toThrow(/projects\[0\]\.scope\.pageKind/);
    expect(() => parseConfig(cfg({ ...all, pageKind: 'movie' }, {}))).toThrow(/scope\.pageKind/);
  });
});
