import { browser } from 'wxt/browser';
import { HIGHLIGHT_PORT_NAME, highlightMessage, type HighlightItem } from './messages';

export interface HighlightConnection {
  update(items: HighlightItem[]): void;
  /** Ends the connection; the page script then removes all frames. Safe to call twice. */
  close(): void;
}

/**
 * Loads the highlight script into the tab (same access as reading) and opens the connection whose end removes the frames.
 * The script is loaded before connecting so the connect has a listener.
 */
export async function connectHighlight(tabId: number): Promise<HighlightConnection> {
  await browser.scripting.executeScript({ target: { tabId }, files: ['/highlight.js'] });
  const port = browser.tabs.connect(tabId, { name: HIGHLIGHT_PORT_NAME });
  let open = true;
  port.onDisconnect.addListener(() => {
    open = false;
  });
  return {
    update(items) {
      if (!open) return;
      try {
        port.postMessage(highlightMessage(items));
      } catch {
        open = false;
      }
    },
    close() {
      if (!open) return;
      open = false;
      port.disconnect();
    },
  };
}
