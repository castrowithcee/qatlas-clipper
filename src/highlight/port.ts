import { parseHighlightMessage } from './messages';
import type { HighlightHandle } from './overlay';

/** The slice of `runtime.Port` the page side uses; kept narrow so tests can pass a plain object. */
export interface HighlightPort {
  name: string;
  onMessage: { addListener(cb: (message: unknown) => void): void };
  onDisconnect: { addListener(cb: () => void): void };
}

/** Ties the overlay's lifetime to the port: messages set the frames, the end of the connection removes everything. */
export function attachHighlightPort(port: HighlightPort, mount: () => HighlightHandle): void {
  const handle = mount();
  port.onMessage.addListener((raw) => {
    const items = parseHighlightMessage(raw);
    if (items) handle.update(items);
  });
  port.onDisconnect.addListener(() => handle.close());
}
