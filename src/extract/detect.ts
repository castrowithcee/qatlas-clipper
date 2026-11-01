import { isObject, nodeTypes, readProperty, toText, type JsonLdNode } from './jsonld';
import { readMeta } from './meta';
import { CONTENT_TYPES, PAGE_TYPES } from './pageTypes';

export const DETECT_VALUES = ['title', 'description', 'author', 'published', 'price', 'company', 'location', 'image', 'siteName'] as const;
export type DetectValue = (typeof DETECT_VALUES)[number];

interface Page {
  url: string;
  doc: Document;
  nodes: JsonLdNode[];
}
type Candidate = (page: Page) => string;

/** Nodes of a content type (see PAGE_TYPES); WebPage, BreadcrumbList and the like never describe the subject. */
function mainNodes(page: Page): JsonLdNode[] {
  return page.nodes.filter((n) => nodeTypes(n).some((t) => CONTENT_TYPES.has(t)));
}

const firstOf = (nodes: JsonLdNode[], read: (node: JsonLdNode) => string): string => {
  for (const node of nodes) {
    const r = read(node);
    if (r) return r;
  }
  return '';
};

/** schema.org property path on the main node; the first node yielding a value wins. */
const ld =
  (path: string, leaf?: string[]): Candidate =>
  (page) =>
    firstOf(mainNodes(page), (n) => readProperty(n, path.split('.'), leaf));

/** Meta tag by name; published pages use `property` (Open Graph) and `name` (Twitter, plain) inconsistently. */
const meta =
  (name: string): Candidate =>
  ({ doc }) =>
    readMeta(doc, 'property', name) || readMeta(doc, 'name', name);

const documentTitle: Candidate = ({ doc }) => (doc.querySelector('title')?.textContent ?? '').replace(/\s+/g, ' ').trim();

function asObjects(v: unknown): JsonLdNode[] {
  return (Array.isArray(v) ? v : [v]).filter(isObject);
}

function priceOf(offer: JsonLdNode): string {
  const spec = asObjects(offer.priceSpecification)[0];
  const amount = toText(offer.price) || toText(offer.lowPrice) || (spec ? toText(spec.price) : '');
  const currency = toText(offer.priceCurrency) || (spec ? toText(spec.priceCurrency) : '');
  return amount && currency ? `${amount} ${currency}` : amount;
}

const offerPrice: Candidate = (page) =>
  firstOf(mainNodes(page), (n) => {
    for (const offer of asObjects(n.offers)) {
      const r = priceOf(offer);
      if (r) return r;
    }
    return '';
  });

const metaPrice =
  (prefix: string): Candidate =>
  (page) => {
    const amount = meta(`${prefix}:amount`)(page);
    const currency = meta(`${prefix}:currency`)(page);
    return amount && currency ? `${amount} ${currency}` : amount;
  };

/** Readable place: address parts "locality, region, country", else the place name. */
function placeText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  for (const place of asObjects(value)) {
    const address = Object.hasOwn(place, 'address') ? place.address : place;
    const text = typeof address === 'string' ? address.trim() : addressParts(address);
    if (text) return text;
    const name = toText(place.name);
    if (name) return name;
  }
  return '';
}

function addressParts(address: unknown): string {
  for (const a of asObjects(address)) {
    const parts = [toText(a.addressLocality), toText(a.addressRegion), readProperty(a, ['addressCountry'])].filter(Boolean);
    const unique = parts.filter((p, i) => p !== parts[i - 1]);
    if (unique.length > 0) return unique.join(', ');
  }
  return '';
}

const place =
  (prop: string): Candidate =>
  (page) =>
    firstOf(mainNodes(page), (n) => (Object.hasOwn(n, prop) ? placeText(n[prop]) : ''));

const LOCAL_BUSINESS: ReadonlySet<string> = new Set(PAGE_TYPES.localBusiness);

/** Own name of a business node: for a LocalBusiness page the company is the node itself. */
const ownBusinessName: Candidate = (page) =>
  firstOf(mainNodes(page), (n) => (nodeTypes(n).some((t) => LOCAL_BUSINESS.has(t)) ? toText(n.name) : ''));

/** Only http(s) URLs, resolved against the page URL; anything else (data:, javascript:) yields nothing. */
function absoluteUrl(raw: string, base: string): string {
  if (!raw) return '';
  try {
    const u = new URL(raw, base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
  } catch {
    return '';
  }
}

const image =
  (c: Candidate): Candidate =>
  (page) =>
    absoluteUrl(c(page), page.url);

const websiteName: Candidate = (page) =>
  firstOf(
    page.nodes.filter((n) => nodeTypes(n).includes('WebSite')),
    (n) => toText(n.name),
  );

/**
 * Candidates per detect value, in fixed order; the first non-empty one wins.
 * No common meta tag exists for company (nearest: product:brand) or location (nearest: geo.placename).
 */
export const DETECTORS: Record<DetectValue, Candidate[]> = {
  title: [ld('name'), ld('headline'), ld('title'), meta('og:title'), meta('twitter:title'), documentTitle],
  description: [ld('description'), meta('og:description'), meta('twitter:description'), meta('description')],
  author: [ld('author'), meta('author'), meta('DC.creator')],
  published: [ld('datePublished'), ld('datePosted'), ld('dateCreated'), meta('article:published_time'), meta('date'), meta('DC.date.issued')],
  price: [offerPrice, metaPrice('product:price'), metaPrice('og:price')],
  company: [ld('hiringOrganization'), ld('brand'), ld('publisher'), ownBusinessName, meta('product:brand')],
  location: [place('jobLocation'), place('location'), place('address'), meta('geo.placename'), meta('og:locality')],
  image: [
    image(ld('image', ['url', 'contentUrl'])),
    image(ld('thumbnailUrl', [])),
    image(meta('og:image')),
    image(meta('og:image:secure_url')),
    image(meta('twitter:image')),
    image(meta('twitter:image:src')),
  ],
  siteName: [websiteName, meta('application-name'), meta('og:site_name')],
};

/** Value for a detect value, or '' when the page carries nothing for it. */
export function detectValue(value: DetectValue, page: Page): string {
  for (const candidate of DETECTORS[value]) {
    const r = candidate(page);
    if (r) return r;
  }
  return '';
}
