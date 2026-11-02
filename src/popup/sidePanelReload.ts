import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { CONFIG_KEY } from '../config';

type Listener<A extends unknown[]> = (...args: A) => void;
interface Source<A extends unknown[]> {
  addListener(l: Listener<A>): void;
  removeListener(l: Listener<A>): void;
}

/** The browser events the side panel listens to; injectable for tests. */
export interface PanelEvents {
  storageChanged: Source<[Record<string, unknown>, string]>;
  tabActivated: Source<[{ tabId: number; windowId: number }]>;
  tabUpdated: Source<[number, { url?: string; status?: string }, { windowId?: number; active?: boolean; id?: number }]>;
}

export interface PanelReloadOptions {
  /** Window of the panel; events of other windows are ignored. Undefined ignores tab events until known. */
  windowId: () => number | undefined;
  /** E2E only: the panel is bound to this tab instead of the active one. */
  pinnedTabId?: number;
  onReload: () => void;
  /** Bursts within this window are coalesced into one trailing reload. */
  delayMs?: number;
}

/**
 * Calls `onReload` when the stored configuration changed or the panel's current tab was switched or navigated.
 * The first event of a burst reloads at once; later events within `delayMs` collapse into a single trailing reload.
 * Returns the unsubscribe function.
 */
export function watchPanelReload(events: PanelEvents, opts: PanelReloadOptions): () => void {
  const delay = opts.delayMs ?? 150;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = false;
  const run = () => {
    timer = undefined;
    if (!pending) return;
    pending = false;
    opts.onReload();
    timer = setTimeout(run, delay);
  };
  const trigger = () => {
    if (timer === undefined) {
      pending = true;
      run();
    } else {
      pending = true;
    }
  };
  const inWindow = (windowId: number | undefined) => windowId !== undefined && windowId === opts.windowId();

  const onStorage: Listener<[Record<string, unknown>, string]> = (changes, area) => {
    if (area === 'local' && CONFIG_KEY in changes) trigger();
  };
  const onActivated: Listener<[{ tabId: number; windowId: number }]> = (info) => {
    if (!inWindow(info.windowId)) return;
    if (opts.pinnedTabId === undefined || info.tabId === opts.pinnedTabId) trigger();
  };
  const onUpdated: Listener<[number, { url?: string; status?: string }, { windowId?: number; active?: boolean; id?: number }]> = (
    tabId,
    change,
    tab,
  ) => {
    if (!inWindow(tab.windowId)) return;
    if (change.url === undefined && change.status !== 'complete') return;
    if (opts.pinnedTabId === undefined ? tab.active === true : tabId === opts.pinnedTabId) trigger();
  };

  events.storageChanged.addListener(onStorage);
  events.tabActivated.addListener(onActivated);
  events.tabUpdated.addListener(onUpdated);
  return () => {
    if (timer !== undefined) clearTimeout(timer);
    events.storageChanged.removeListener(onStorage);
    events.tabActivated.removeListener(onActivated);
    events.tabUpdated.removeListener(onUpdated);
  };
}

const defaultEvents = (): PanelEvents => ({
  storageChanged: browser.storage.onChanged as unknown as PanelEvents['storageChanged'],
  tabActivated: browser.tabs.onActivated as unknown as PanelEvents['tabActivated'],
  tabUpdated: browser.tabs.onUpdated as unknown as PanelEvents['tabUpdated'],
});

/** Reload token for `PopupApp`: increases whenever the panel should read the active tab and configuration again. */
export function useSidePanelReload(pinnedTabId?: number, events?: PanelEvents): number {
  const [token, setToken] = useState(0);
  useEffect(() => {
    let windowId: number | undefined;
    let alive = true;
    void browser.windows
      .getCurrent()
      .then((w) => {
        if (alive) windowId = w.id;
      })
      .catch(() => undefined);
    const stop = watchPanelReload(events ?? defaultEvents(), {
      windowId: () => windowId,
      pinnedTabId,
      onReload: () => setToken((n) => n + 1),
    });
    return () => {
      alive = false;
      stop();
    };
  }, [pinnedTabId, events]);
  return token;
}
