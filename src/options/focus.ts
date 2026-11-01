import { browser } from 'wxt/browser';
import type { StorageArea } from '../config';

/** Handoff from the popup to the options page: which project view to show. */
export const OPTIONS_FOCUS_KEY = 'optionsFocus';
/** A request older than this is a leftover and ignored. */
export const FOCUS_MAX_AGE_MS = 30_000;

/** Storage area plus a change subscription, so tests can inject a fake. */
export interface FocusChannel {
  storage: StorageArea;
  onChange(cb: () => void): () => void;
}

/** storage.session (extension pages only, not persisted); local where it is unavailable. */
export const defaultFocusChannel = (): FocusChannel => {
  // Outside an extension (unit tests) there is no storage: an inert channel.
  if (!(browser as { storage?: unknown } | undefined)?.storage) return { storage: { get: async () => ({}), set: async () => undefined }, onChange: () => () => undefined };
  const session = (browser.storage as { session?: unknown }).session;
  const area = session ? 'session' : 'local';
  return {
    storage: (session ?? browser.storage.local) as unknown as StorageArea,
    onChange: (cb) => {
      const listener = (_changes: unknown, name: string) => name === area && cb();
      browser.storage.onChanged.addListener(listener);
      return () => browser.storage.onChanged.removeListener(listener);
    },
  };
};

export async function requestOptionsFocus(storage: StorageArea, projectId: string, now = Date.now()): Promise<void> {
  await storage.set({ [OPTIONS_FOCUS_KEY]: { projectId, at: now } });
}

/** Stored values are data: only a non-empty string id and a recent timestamp count. */
export function parseFocus(raw: unknown, now = Date.now()): string | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { projectId, at } = raw as Record<string, unknown>;
  if (typeof projectId !== 'string' || projectId === '' || typeof at !== 'number') return undefined;
  return Math.abs(now - at) <= FOCUS_MAX_AGE_MS ? projectId : undefined;
}

/** Returns the requested project id once and clears the request; null is the cleared state. */
export async function takeOptionsFocus(storage: StorageArea): Promise<string | undefined> {
  const id = parseFocus((await storage.get([OPTIONS_FOCUS_KEY]))[OPTIONS_FOCUS_KEY]);
  if (id !== undefined) await storage.set({ [OPTIONS_FOCUS_KEY]: null });
  return id;
}
