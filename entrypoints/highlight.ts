import { browser } from 'wxt/browser';
import { HIGHLIGHT_PORT_NAME } from '../src/highlight/messages';
import { mountHighlight } from '../src/highlight/overlay';
import { attachHighlightPort } from '../src/highlight/port';

/** Every injection runs this file again in the same isolated world; the listener must be registered only once. */
const LISTENER_KEY = Symbol.for('qatlas.highlight.listener');

export default defineUnlistedScript(() => {
  const g = globalThis as unknown as Record<symbol, boolean | undefined>;
  if (g[LISTENER_KEY]) return;
  g[LISTENER_KEY] = true;
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== HIGHLIGHT_PORT_NAME) return;
    attachHighlightPort(port, () => mountHighlight());
  });
});
