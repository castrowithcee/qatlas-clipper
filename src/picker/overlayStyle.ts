import { shadowTokensCss } from '../ui/tokens';

/**
 * Host styles are inline and `!important`: page rules such as `div { display: none !important }` or
 * `* { all: unset !important }` match the host element itself, and only an inline `!important` declaration outranks them.
 */
export const HOST_STYLE = [
  'all: initial',
  'display: block',
  'position: fixed',
  'top: 0',
  'left: 0',
  'width: 0',
  'height: 0',
  'overflow: visible',
  'visibility: visible',
  'opacity: 1',
  'transform: none',
  'z-index: 2147483647',
]
  .map((d) => `${d} !important`)
  .join('; ');

const MIX = (token: string, percent: number) => `color-mix(in srgb, var(${token}) ${percent}%, transparent)`;

/** Semantic tokens only; motion runs through --motion-duration, which the tokens zero for reduced motion. */
export const OVERLAY_CSS = `${shadowTokensCss()}
/* The shared spacing tokens are in rem, which follows the page's root font size; the overlay must not. */
:host { --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-5: 24px; }
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }

/* Hover is dashed, picked is solid, not unique is dotted: the state never relies on color alone. The halo keeps the frame visible on pages that share the frame color. */
.box { position: fixed; display: none; pointer-events: none; border: 2px dashed var(--color-accent); border-radius: 2px;
  background: ${MIX('--color-accent', 14)}; box-shadow: 0 0 0 2px var(--color-bg); }
.box.picked { border-style: solid; border-width: 3px; border-color: var(--color-success); background: ${MIX('--color-success', 16)}; }
.box.invalid { border-style: dotted; border-width: 3px; border-color: var(--color-warning); background: ${MIX('--color-warning', 16)}; }

.bar { position: fixed; left: var(--space-2); right: var(--space-2); max-width: 640px; margin: 0 auto;
  display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-2) var(--space-3);
  pointer-events: auto; color: var(--color-text); background: var(--color-bg);
  border: 1px solid var(--color-border); border-radius: var(--radius-md);
  box-shadow: 0 4px 16px ${MIX('--color-text', 28)};
  font: var(--font-size-base) / var(--line-height) var(--font-sans); text-align: start; letter-spacing: normal;
  --shift: 6px; animation: enter var(--motion-duration) var(--motion-ease); }
.bar.bottom { bottom: var(--space-2); }
.bar.top { top: var(--space-2); --shift: -6px; }
@keyframes enter { from { opacity: 0; transform: translateY(var(--shift)); } }

.line { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.title { font-weight: 600; overflow-wrap: anywhere; }
.keyhint { color: var(--color-text-muted); font-size: var(--font-size-small); }
.preview { display: flex; flex-direction: column; gap: 2px; padding: var(--space-2) var(--space-3);
  background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-sm); }
.preview-label { color: var(--color-text-muted); font-size: var(--font-size-small); }
.preview-text { overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.hint, .error, .done { display: flex; align-items: flex-start; gap: var(--space-2); overflow-wrap: anywhere; }
.hint { color: var(--color-text-muted); }
.hint.warn { color: var(--color-warning); font-weight: 600; }
.error { color: var(--color-danger); font-weight: 600; }
.done { color: var(--color-success); font-weight: 600; }
.icon { width: 1.125em; height: 1.125em; flex: none; margin-top: 0.15em; }

.spacer { flex: 1; }
button { font: inherit; font-size: var(--font-size-base); line-height: var(--line-height); color: var(--color-text);
  display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2);
  min-height: 36px; padding: var(--space-2) var(--space-4); cursor: pointer;
  background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-md);
  transition: background-color var(--motion-duration) var(--motion-ease), border-color var(--motion-duration) var(--motion-ease); }
button:hover:not(:disabled) { background: var(--color-surface); border-color: var(--color-text-muted); }
button:disabled { opacity: 0.5; cursor: not-allowed; }
button:focus-visible { outline: 3px solid var(--color-focus); outline-offset: 2px; }
`;
