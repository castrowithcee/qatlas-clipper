import { shadowTokensCss } from '../ui/tokens';

// Same inline `!important` host as the picker: page rules must not hide or move the host.
export { HOST_STYLE } from '../picker/overlayStyle';

const MIX = (token: string, percent: number) => `color-mix(in srgb, var(${token}) ${percent}%, transparent)`;

/**
 * Nothing here takes pointer events. Frames are solid (the picker's hover frame is dashed, picked is solid green), and
 * every frame carries a text label, so the state never relies on color alone. The halo keeps the frame visible on pages
 * that share the frame color.
 */
export const HIGHLIGHT_CSS = `${shadowTokensCss()}
:host { --space-1: 4px; --space-2: 8px; }
*, *::before, *::after { box-sizing: border-box; pointer-events: none !important; }
[hidden] { display: none !important; }

.frame { position: fixed; border: 2px solid var(--color-accent); border-radius: 2px;
  background: ${MIX('--color-accent', 8)}; box-shadow: 0 0 0 2px var(--color-bg); }
.label { position: absolute; left: -2px; bottom: 100%; max-width: 240px; margin-bottom: 4px;
  padding: 1px var(--space-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--color-text); background: var(--color-bg); border: 1px solid var(--color-accent); border-radius: var(--radius-sm);
  box-shadow: 0 1px 4px ${MIX('--color-text', 28)};
  font: 600 var(--font-size-small) / var(--line-height) var(--font-sans); text-align: start; letter-spacing: normal; }
.frame.inside .label { bottom: auto; top: 0; left: 0; margin: 0; border-top: 0; border-left: 0; border-radius: 0 0 var(--radius-sm) 0; }
`;
