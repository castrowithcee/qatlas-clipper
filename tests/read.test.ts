// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMarkdownContent } from 'defuddle/full';
import type { Project } from '../src/config/schema';

vi.mock('defuddle/full', async (importOriginal) => {
  const actual = await importOriginal<typeof import('defuddle/full')>();
  return { ...actual, createMarkdownContent: vi.fn(actual.createMarkdownContent) };
});
const executeScript = vi.hoisted(() => vi.fn<(opts: unknown) => Promise<unknown[]>>(async () => []));
const tabsGet = vi.hoisted(() => vi.fn<(id: number) => Promise<{ url?: string }>>(async () => ({ url: 'https://example.com/a' })));
vi.mock('wxt/browser', () => ({ browser: { scripting: { executeScript }, tabs: { get: tabsGet } } }));

import { MAX_CONTENT_CHARS, buildReadResult } from '../src/extract/result';
import { isUnreadableUrl, readTab } from '../src/extract/inject';

const URL_ = 'https://www.example.com/articles/1';
const ARTICLE = `<!doctype html><html><head><title>Fallback</title>
<meta property="og:site_name" content="Example Site">
<script type="application/ld+json">{"@type":"Article","headline":"Hello Headline","author":{"@type":"Person","name":"Jane"}}</script>
</head><body><nav>Menu</nav><article><h1>Hello Headline</h1><p>${'First paragraph with enough words to count as content. '.repeat(10)}</p><p>Second paragraph.</p></article><footer>Footer</footer></body></html>`;
const doc = (h = ARTICLE) => new DOMParser().parseFromString(h, 'text/html');

function project(id: string, extra: Partial<Project> = {}): Project {
  return {
    id,
    name: id,
    scope: { allSites: true, domains: [] },
    fields: [
      { key: 'headline', label: 'Headline', required: false, sources: { schemaOrgPath: 'Article.headline' } },
      { key: 'site', label: 'Site', required: false, sources: { metaTag: { attribute: 'property', name: 'og:site_name' } } },
      { key: 'note', label: 'Note', required: false, sources: {} },
    ],
    siteMappings: {},
    targets: [],
    ...extra,
  };
}

describe('buildReadResult', () => {
  it('returns title, url, markdown, types, matching projects and fields with source', () => {
    const d = doc();
    const before = d.documentElement.outerHTML;
    const r = buildReadResult(URL_, d, [project('a'), project('b', { scope: { allSites: false, domains: ['other.test'] } })]);
    expect(r.title).toBe('Hello Headline');
    expect(r.url).toBe(URL_);
    expect(r.contentFormat).toBe('markdown');
    expect(r.content).toContain('First paragraph');
    expect(r.contentTruncated).toBe(false);
    expect(r.jsonLdTypes).toEqual(['Article']);
    expect(r.matchingProjects).toEqual([{ id: 'a', name: 'a' }]);
    expect(r.selectedProjectId).toBe('a');
    expect(r.fields).toEqual({
      headline: { value: 'Hello Headline', source: 'schemaOrg' },
      site: { value: 'Example Site', source: 'meta' },
      note: { value: '', source: 'manual' },
    });
    expect(d.documentElement.outerHTML).toBe(before);
  });

  it('picks the requested matching project, else the first; none gives empty fields', () => {
    const ps = [project('a'), project('b')];
    expect(buildReadResult(URL_, doc(), ps, 'b').selectedProjectId).toBe('b');
    expect(buildReadResult(URL_, doc(), ps).selectedProjectId).toBe('a');
    const miss = buildReadResult(URL_, doc(), ps, 'unknown');
    expect(miss.selectedProjectId).toBeNull();
    expect(miss.fields).toEqual({});
    expect(buildReadResult(URL_, doc(), []).fields).toEqual({});
  });

  it('truncates long content and flags it', () => {
    const r = buildReadResult(URL_, doc(), [], undefined, 100);
    expect(r.contentTruncated).toBe(true);
    expect(r.content.endsWith('[… truncated]')).toBe(true);
    expect(r.content.length).toBeLessThan(100 + 20);
    expect(MAX_CONTENT_CHARS).toBeGreaterThan(1000);
    const h = buildReadResult(URL_, doc(), [project('h', { content: 'html' })], undefined, 100);
    expect(h.contentTruncated).toBe(true);
    expect(h.content.endsWith('[… truncated]')).toBe(true);
    expect(h.content.length).toBeLessThan(100 + 20);
  });
});

const RICH = `<!doctype html><html><head><title>Rich</title></head><body><nav>Menu</nav><article>
<h1>Rich Title</h1>
<p>${'Intro paragraph with a <a href="/docs/start" onclick="x()">relative link</a> and enough words to count as content. '.repeat(6)}</p>
<ul><li>First item in the list with enough words to stay</li><li>Second item in the list with enough words to stay</li></ul>
<p style="color:red" onmouseover="x()">Styled <img src="/img/a.png" srcset="/img/a.png 1x, /img/b.png 2x" alt="A"> paragraph. <a href="javascript:alert(1)">bad</a></p>
<iframe title="x"></iframe><script>alert(1)</script><style>p{}</style><noscript>ns</noscript><template><p>t</p></template>
<form action="/f"><label>Name <input name="n"></label><select><option>o</option></select><textarea>t</textarea><button>Go</button></form>
<p>${'More body text to make this the main content of the page. '.repeat(10)}</p>
</article><footer>Footer</footer></body></html>`;

describe('content formats', () => {
  it('markdown is real Markdown without HTML tags', () => {
    const r = buildReadResult(URL_, doc(RICH), [project('a')]);
    expect(r.contentFormat).toBe('markdown');
    expect(r.content).not.toMatch(/<(p|div|body|ul|li|h1|a)[\s>]/);
    expect(r.content).toMatch(/^#+ /m);
    expect(r.content).toMatch(/^[-*] First item/m);
    expect(r.content).toMatch(/\[relative link\]\(https:\/\/www\.example\.com\/docs\/start\)/);
    expect(r.content).not.toContain('<iframe');
    expect(r.content).not.toContain('Menu');
    expect(r.content).not.toContain('Footer');
  });

  it('missing content setting means markdown; explicit values are used', () => {
    expect(buildReadResult(URL_, doc(RICH), [project('a')]).contentFormat).toBe('markdown');
    expect(buildReadResult(URL_, doc(RICH), [project('a', { content: 'html' })]).contentFormat).toBe('html');
  });

  it('html is sanitized and has only absolute links', () => {
    const r = buildReadResult(URL_, doc(RICH), [project('a', { content: 'html' })]);
    expect(r.contentFormat).toBe('html');
    expect(r.content).toContain('<p');
    expect(r.content).toContain('relative link');
    expect(r.content).not.toMatch(/<(iframe|frame|object|embed|script|style|noscript|template|form|input|button|select|textarea|option|label)[\s>]/i);
    expect(r.content).not.toMatch(/\son[a-z]+\s*=/i);
    expect(r.content).not.toMatch(/\sstyle\s*=/i);
    expect(r.content).not.toContain('javascript:');
    expect(r.content).toContain('href="https://www.example.com/docs/start"');
    expect(r.content).toContain('src="https://www.example.com/img/a.png"');
    expect(r.content).toContain('https://www.example.com/img/b.png 2x');
    const links = [...r.content.matchAll(/\b(?:href|src)="([^"]*)"/g)].map((m) => m[1]!);
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l).toMatch(/^https?:\/\//);
  });

  it('none sends empty content and never converts', () => {
    const convert = vi.mocked(createMarkdownContent);
    convert.mockClear();
    const r = buildReadResult(URL_, doc(RICH), [project('a', { content: 'none' })]);
    expect(r.content).toBe('');
    expect(r.contentFormat).toBe('none');
    expect(r.contentTruncated).toBe(false);
    expect(convert).not.toHaveBeenCalled();
    expect(r.fields.headline).toBeDefined();
  });
});

describe('isUnreadableUrl', () => {
  it.each([
    'chrome://extensions',
    'edge://settings',
    'about:blank',
    'file:///tmp/a.html',
    'https://chromewebstore.google.com/detail/x',
    'https://chrome.google.com/webstore/detail/x',
    'https://example.com/doc.PDF',
    'not a url',
  ])('rejects %s', (u) => expect(isUnreadableUrl(u)).toBe(true));
  it('accepts normal pages', () => expect(isUnreadableUrl('https://example.com/a')).toBe(false));
});

describe('readTab', () => {
  beforeEach(() => {
    executeScript.mockReset();
    tabsGet.mockReset();
    tabsGet.mockResolvedValue({ url: 'https://example.com/a' });
  });

  it('returns unsupported for unreadable pages without injecting', async () => {
    tabsGet.mockResolvedValue({ url: 'chrome://extensions' });
    const r = await readTab(1, []);
    expect(r).toMatchObject({ ok: false, kind: 'unsupported' });
    expect(executeScript).not.toHaveBeenCalled();
  });

  it('returns no-access when the tab URL is hidden', async () => {
    tabsGet.mockResolvedValue({});
    expect(await readTab(1, [])).toMatchObject({ ok: false, kind: 'no-access' });
  });

  it('turns thrown errors into a message without their text', async () => {
    executeScript.mockRejectedValue(new Error('secret page detail'));
    const r = await readTab(1, []);
    expect(r).toMatchObject({ ok: false, kind: 'failed' });
    expect(JSON.stringify(r)).not.toContain('secret');
    tabsGet.mockRejectedValue(new Error('No tab'));
    expect(await readTab(2, [])).toMatchObject({ ok: false, kind: 'failed' });
  });

  it('injects, strips targets, and returns the reader result', async () => {
    const result = buildReadResult(URL_, doc(), [project('a')]);
    executeScript.mockResolvedValueOnce([]).mockResolvedValueOnce([{ result: { ok: true, result } }]);
    const withTarget = project('a', { targets: [{ id: 't', name: 'T', url: 'https://hook.example.com', headerNames: ['X-Key'] } as never] });
    const r = await readTab(3, [withTarget], 'a');
    expect(r).toEqual({ ok: true, result });
    expect((executeScript.mock.calls[0]![0] as { files: string[] }).files).toEqual(['/reader.js']);
    const args = (executeScript.mock.calls[1]![0] as { args: [string, Project[], string] }).args;
    expect(args[1]![0]!.targets).toEqual([]);
    expect(args[2]).toBe('a');
  });

  it('maps reader failures and empty results to errors', async () => {
    executeScript.mockResolvedValueOnce([]).mockResolvedValueOnce([{ result: { ok: false, kind: 'unsupported' } }]);
    expect(await readTab(1, [])).toMatchObject({ ok: false, kind: 'unsupported' });
    executeScript.mockResolvedValueOnce([]).mockResolvedValueOnce([{}]);
    expect(await readTab(1, [])).toMatchObject({ ok: false, kind: 'failed' });
  });
});
