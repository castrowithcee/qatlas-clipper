// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import { generateSelector, isGeneratedToken } from '../src/picker/selector';

beforeAll(() => {
  // Test-only fallback in case the environment lacks CSS.escape.
  const g = globalThis as unknown as { CSS?: { escape?: (v: string) => string } };
  g.CSS ??= {};
  g.CSS.escape ??= (v: string) => v.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
});

const parse = (body: string): Document =>
  new DOMParser().parseFromString(`<!doctype html><html><body>${body}</body></html>`, 'text/html');

const fixtures: Record<string, string> = {
  id: '<h1 id="title">Article</h1><p>Text</p>',
  generatedId: '<div id=":r0:">Product</div><div id="ember123">Product</div><div id="a1b2c3d4e5f6">x</div>',
  data: '<span data-testid="price">9</span><span data-qa="x">1</span><span data-field="f">2</span>',
  classes: '<p class="price">1</p><p class="css-1x2y3z">2</p><p class="Card_title__aB3dE">3</p>',
  generatedClasses: '<a class="sc-abc123 jsx-123 svelte-1abc2d">a</a><a class="sc-abc123 jsx-123 svelte-1abc2d">b</a>',
  ancestor:
    '<section id="list-a"><button class="css-9x8y7z">Buy</button></section>' +
    '<section id="list-b"><button class="css-9x8y7z">Buy</button></section>',
  ambiguous: '<div><span>x</span></div><div><span>x</span></div>',
  mixed:
    '<div id="a1b2c3d4e5f6" data-testid="box" class="card css-1x2y3z"><b id="real">t</b></div><div class="card"><i>t</i></div>',
};

const fx = (k: string): string => fixtures[k] ?? "";

const all = Object.entries(fixtures).flatMap(([name, html]) => {
  const doc = parse(html);
  return Array.from(doc.querySelectorAll('*')).map((el) => ({ name, doc, el }));
});

describe('generateSelector', () => {
  it('prefers id over data attribute over class', () => {
    const doc = parse('<div id="main" data-testid="t" class="card"></div><div data-testid="u" class="card"></div>');
    expect(generateSelector(doc.querySelector('#main')!)).toEqual({ unique: true, selector: '#main' });
    expect(generateSelector(doc.querySelector('[data-testid="u"]')!)).toEqual({
      unique: true,
      selector: '[data-testid="u"]',
    });
    const d2 = parse('<p class="price">1</p><p>2</p>');
    expect(generateSelector(d2.querySelector('.price')!)).toEqual({ unique: true, selector: '.price' });
  });

  it('prefers data-testid over other data attributes', () => {
    const doc = parse('<i data-x="one" data-testid="two"></i>');
    expect(generateSelector(doc.querySelector('i')!)).toEqual({ unique: true, selector: '[data-testid="two"]' });
  });

  it('avoids generated ids and classes', () => {
    const doc = parse(fx("mixed"));
    const r = generateSelector(doc.querySelector('[data-testid="box"]')!);
    expect(r).toEqual({ unique: true, selector: '[data-testid="box"]' });
    const gen = parse(fx("generatedClasses"));
    const first = gen.querySelector('a')!;
    expect(generateSelector(first).unique).toBe(false);
  });

  it('combines with a stable ancestor', () => {
    const doc = parse(fx("ancestor"));
    const btn = doc.querySelector('#list-b button')!;
    const r = generateSelector(btn);
    expect(r).toEqual({ unique: true, selector: '#list-b > button' });
  });

  it('flags ambiguity instead of falling back to a positional selector', () => {
    const doc = parse(fx("ambiguous"));
    const r = generateSelector(doc.querySelector('span')!);
    expect(r.unique).toBe(false);
    expect(r.selector).toBeNull();
    if (!r.unique) expect(r.reason).not.toBe('');
  });

  it('returns unique selectors matching exactly the target and never positional ones', () => {
    let uniqueCount = 0;
    let flaggedCount = 0;
    for (const { doc, el } of all) {
      const r = generateSelector(el);
      if (r.unique) {
        uniqueCount++;
        const found = doc.querySelectorAll(r.selector);
        expect(found).toHaveLength(1);
        expect(found[0]).toBe(el);
        expect(r.selector).not.toMatch(
          /nth-|first-child|last-child|only-child|first-of-type|last-of-type|only-of-type/,
        );
        expect(r.selector).not.toMatch(/css-1x2y3z|sc-abc123|jsx-123|svelte-1abc2d|ember123|a1b2c3d4e5f6|:r0:/);
      } else {
        flaggedCount++;
        expect(r.selector).toBeNull();
      }
    }
    expect(uniqueCount).toBeGreaterThan(0);
    expect(flaggedCount).toBeGreaterThan(0);
  });
});

describe('isGeneratedToken', () => {
  it.each([
    ':r0:', 'ember123', 'css-1x2y3z', 'sc-abc123', 'jsx-123', 'Component_title__aB3dE', 'svelte-1abc2d',
    '123e4567-e89b-12d3-a456-426614174000', 'deadbeef12', 'item-123456', 'a1b2c3d4e5f6',
  ])('flags %s', (t) => expect(isGeneratedToken(t)).toBe(true));

  it.each(['title', 'price', 'card-header', 'col-12', 'btn_primary', 'data-field', 'h2'])('keeps %s', (t) =>
    expect(isGeneratedToken(t)).toBe(false),
  );
});
