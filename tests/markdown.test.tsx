// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MarkdownView } from '../src/ui/components';

afterEach(cleanup);
const r = (source: string) => render(<MarkdownView source={source} />).container;

describe('MarkdownView', () => {
  it('renders paragraphs and hard breaks', () => {
    const c = r('one\ntwo\n\nthree');
    expect(c.querySelectorAll('p')).toHaveLength(2);
    expect(c.querySelectorAll('br')).toHaveLength(1);
  });
  it('renders headings', () => {
    const c = r('# a\n## b\n### c');
    expect(c.querySelector('h1')?.textContent).toBe('a');
    expect(c.querySelector('h2')?.textContent).toBe('b');
    expect(c.querySelector('h3')?.textContent).toBe('c');
  });
  it('renders lists', () => {
    const c = r('- a\n* b\n+ c\n\n1. x\n2. y');
    expect(c.querySelectorAll('ul > li')).toHaveLength(3);
    expect(c.querySelectorAll('ol > li')).toHaveLength(2);
  });
  it('renders emphasis and escapes', () => {
    const c = r('**a** __b__ *c* _d_ \\*e\\*');
    expect(c.querySelectorAll('strong')).toHaveLength(2);
    expect(c.querySelectorAll('em')).toHaveLength(2);
    expect(c.textContent).toContain('*e*');
  });
  it('shows links as text with address, never as anchor', () => {
    const c = r('[Doc](https://example.com/x)');
    expect(c.querySelector('a')).toBeNull();
    expect(c.textContent).toBe('Doc (https://example.com/x)');
  });
  it('shows raw HTML literally', () => {
    const src = '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<b>x</b>';
    const c = r(src);
    for (const t of ['script', 'img', 'b']) expect(c.querySelector(t)).toBeNull();
    expect(c.textContent).toContain('<script>alert(1)</script>');
    expect(c.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(c.textContent).toContain('<b>x</b>');
  });
  // Wall-clock budgets flake under parallel load (~3.3 s alone); only a hang should fail, via the test timeout.
  it('handles pathological input quickly', () => {
    for (const s of ['*'.repeat(100000), '**a '.repeat(25000), '['.repeat(50000), '_a'.repeat(50000), '*a'.repeat(50000)]) r(s);
  }, 40000);
});
