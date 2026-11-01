export type Appearance = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

export const DARK_QUERY = '(prefers-color-scheme: dark)';

export const resolveTheme = (appearance: Appearance, systemPrefersDark: boolean): Theme =>
  appearance === 'system' ? (systemPrefersDark ? 'dark' : 'light') : appearance;

/** Sets the explicit theme on the document root; the tokens react to `data-theme`. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  root.dataset.theme = theme;
}

/** Injects the token stylesheet once per document. */
export function installTokens(css: string, doc: Document = document): void {
  if (doc.getElementById('qatlas-tokens')) return;
  const style = doc.createElement('style');
  style.id = 'qatlas-tokens';
  style.textContent = css;
  doc.head.prepend(style);
}
