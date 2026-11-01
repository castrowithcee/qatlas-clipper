import { describe, expect, it } from 'vitest';
import { DARK_TOKENS, LIGHT_TOKENS, pageTokensCss, shadowTokensCss } from '../src/ui';

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe.each([['light', LIGHT_TOKENS], ['dark', DARK_TOKENS]])('%s tokens meet WCAG AA', (_, t) => {
  const bgs = ['--color-bg', '--color-surface'];
  for (const fg of ['--color-text', '--color-text-muted', '--color-accent', '--color-success', '--color-warning', '--color-danger']) {
    for (const bg of bgs) {
      it(`${fg} on ${bg}`, () => expect(contrast(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(4.5));
    }
  }
  it('on-accent text on accent', () => expect(contrast(t['--color-on-accent']!, t['--color-accent']!)).toBeGreaterThanOrEqual(4.5));
  it('focus ring on bg (3:1)', () => expect(contrast(t['--color-focus']!, t['--color-bg']!)).toBeGreaterThanOrEqual(3));
});

describe('token css', () => {
  it('scopes to :root for pages and :host for the shadow DOM', () => {
    expect(pageTokensCss()).toContain(":root[data-theme='dark']");
    expect(pageTokensCss()).toContain('prefers-reduced-motion');
    expect(shadowTokensCss()).toContain(":host([data-theme='dark'])");
    expect(shadowTokensCss()).not.toContain(':root');
  });
});
