/** Semantic design tokens as CSS variables; one source for extension pages (`:root`) and the picker's Shadow DOM (`:host`). */

const light = {
  'color-scheme': 'light',
  '--color-bg': '#ffffff',
  '--color-surface': '#f6f8fa',
  '--color-text': '#1f2328',
  '--color-text-muted': '#57606a',
  '--color-border': '#d0d7de',
  '--color-accent': '#0b5cad',
  '--color-on-accent': '#ffffff',
  '--color-success': '#1a7f37',
  '--color-warning': '#8a5a00',
  '--color-danger': '#b00020',
  '--color-focus': '#0b5cad',
} as const;

const dark: Record<keyof typeof light, string> = {
  'color-scheme': 'dark',
  '--color-bg': '#16181c',
  '--color-surface': '#1f2227',
  '--color-text': '#e6e8eb',
  '--color-text-muted': '#a7afb8',
  '--color-border': '#3d444d',
  '--color-accent': '#6cb0f5',
  '--color-on-accent': '#0b1b2b',
  '--color-success': '#4cc16a',
  '--color-warning': '#e3b341',
  '--color-danger': '#ff7b8a',
  '--color-focus': '#6cb0f5',
};

/** Theme-independent tokens. Density differs per surface: compact in the popup, roomier on the options page. */
const shared = {
  '--space-1': '0.25rem',
  '--space-2': '0.5rem',
  '--space-3': '0.75rem',
  '--space-4': '1rem',
  '--space-5': '1.5rem',
  '--radius-sm': '4px',
  '--radius-md': '6px',
  '--font-sans': "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  '--font-mono': "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  '--font-size-base': '14px',
  '--font-size-small': '12px',
  '--line-height': '1.45',
  '--motion-duration': '120ms',
  '--motion-ease': 'ease-out',
} as const;

const block = (selector: string, vars: Record<string, string>) =>
  `${selector}{${Object.entries(vars).map(([k, v]) => `${k}:${v};`).join('')}}`;

export const LIGHT_TOKENS: Readonly<Record<string, string>> = light;
export const DARK_TOKENS: Readonly<Record<string, string>> = dark;

const reducedMotion = (selector: string) =>
  `@media (prefers-reduced-motion: reduce){${block(selector, { '--motion-duration': '0ms' })}}`;

/**
 * Extension pages: the explicit `data-theme` attribute on the root wins; without it the OS preference applies,
 * so the first paint is right before the script has run.
 */
export function pageTokensCss(): string {
  return [
    block(':root', { ...light, ...shared }),
    `@media (prefers-color-scheme: dark){${block(':root:not([data-theme])', dark)}}`,
    block(":root[data-theme='dark']", dark),
    block(":root[data-theme='light']", light),
    reducedMotion(':root'),
  ].join('\n');
}

/** Shadow DOM: the host element carries `data-theme` ("light" or "dark"); the caller resolves "system" itself. */
export function shadowTokensCss(): string {
  return [
    block(':host', { ...light, ...shared }),
    block(":host([data-theme='dark'])", dark),
    block(":host([data-theme='light'])", light),
    reducedMotion(':host'),
  ].join('\n');
}
