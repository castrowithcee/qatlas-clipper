import type { Settings } from './schema';

type OpenAs = Settings['openAs'];

export interface OpenAsApis {
  action: { setPopup(details: { popup: string }): Promise<void> | void };
  /** Missing in browsers without a side panel. */
  sidePanel?: {
    setPanelBehavior(behavior: { openPanelOnActionClick: boolean }): Promise<void> | void;
    open(options: { tabId: number }): Promise<void> | void;
  };
}

/** Sent by the service worker to an open side panel after a click on the toolbar button. */
export const PANEL_CLICK_TYPE = 'qatlas-clipper/panel-click';

export interface PanelClickMessage {
  type: typeof PANEL_CLICK_TYPE;
  tabId: number;
}

/** Popup document from the manifest; used when the action returns from the side panel to the popup. */
export const FALLBACK_POPUP_PATH = 'popup.html';

/** The side panel needs `chrome.sidePanel`; without it the popup always applies. */
export const sidePanelSupported = (root: { chrome?: { sidePanel?: unknown } } = globalThis): boolean =>
  typeof root.chrome?.sidePanel === 'object' && root.chrome.sidePanel !== null;

export const effectiveOpenAs = (openAs: OpenAs, supported: boolean): OpenAs => (supported ? openAs : 'popup');

/** Switches what a click on the toolbar button opens. Without a side panel API only the popup is set. */
export async function applyOpenAs(openAs: OpenAs, apis: OpenAsApis, popupPath = FALLBACK_POPUP_PATH): Promise<void> {
  const mode = effectiveOpenAs(openAs, apis.sidePanel !== undefined);
  if (mode === 'sidepanel') {
    // An empty popup makes the click fire action.onClicked. openPanelOnActionClick stays off: the browser would then
    // open the panel itself without granting activeTab to the extension.
    await apis.action.setPopup({ popup: '' });
    await apis.sidePanel!.setPanelBehavior({ openPanelOnActionClick: false });
    return;
  }
  await apis.action.setPopup({ popup: popupPath });
  await apis.sidePanel?.setPanelBehavior({ openPanelOnActionClick: false });
}

export interface RegisterOpenAsDeps {
  apis: OpenAsApis;
  popupPath?: string;
  load: () => Promise<Settings>;
  subscribe: (onChange: (settings: Settings) => void) => () => void;
  onInstalled: { addListener(listener: () => void): void };
  onStartup: { addListener(listener: () => void): void };
  /** Fires only while no popup is set, i.e. in side panel mode. */
  onActionClicked: { addListener(listener: (tab: { id?: number }) => void): void };
  /** Tells an open side panel about the click; rejects when no panel listens. */
  notifyPanel: (message: PanelClickMessage) => Promise<unknown> | void;
}

/** Applies the setting on install, browser start and every change. Failures are swallowed: the previous behavior stays. */
export function registerOpenAs(deps: RegisterOpenAsDeps): { apply: () => Promise<void> } {
  const run = (openAs: OpenAs) => applyOpenAs(openAs, deps.apis, deps.popupPath).catch(() => undefined);
  const apply = async () => run((await deps.load().catch(() => ({ openAs: 'popup' as const }))).openAs);
  // Registered synchronously at start so a click wakes the worker into it. sidePanel.open must be called without an
  // earlier await, otherwise the user gesture is gone and the browser grants neither the panel nor activeTab.
  deps.onActionClicked.addListener((tab) => {
    const tabId = tab.id;
    if (tabId === undefined || !deps.apis.sidePanel) return;
    try {
      Promise.resolve(deps.apis.sidePanel.open({ tabId }))
        .then(() => deps.notifyPanel({ type: PANEL_CLICK_TYPE, tabId }))
        .catch(() => undefined);
    } catch {
      // Ignored: the panel stays closed.
    }
  });
  deps.onInstalled.addListener(() => void apply());
  deps.onStartup.addListener(() => void apply());
  deps.subscribe((s) => void run(s.openAs));
  return { apply };
}

/** Browser APIs of the direct switch; every function may be missing in older browsers. */
export interface SwitchApis {
  action?: {
    setPopup?(details: { popup: string }): Promise<void> | void;
    openPopup?(): Promise<void> | void;
  };
  sidePanel?: {
    open?(options: { tabId: number }): Promise<void> | void;
    close?(options: { tabId: number }): Promise<void> | void;
  };
}

/** `switched`: the other view is open and this one closed. `failed`: the setting changed, this view stays open. */
export type SwitchResult = 'switched' | 'failed' | 'save-failed';

export interface SwitchDeps {
  from: OpenAs;
  tabId: number;
  apis: SwitchApis;
  /** Stores the new `openAs` (the service worker then applies it to the toolbar button). */
  save: (openAs: OpenAs) => Promise<void>;
  /** Closes the view the switch started from; for the side panel after `sidePanel.close` was not possible. */
  closeSelf: () => void;
  popupPath?: string;
}

/** The switch exists only where the side panel API exists. */
export const switchSupported = (apis: SwitchApis): boolean => apis.sidePanel !== undefined;

/** Reads the extension APIs of the global `chrome` object; undefined parts stay undefined. */
export function chromeSwitchApis(root: { chrome?: unknown } = globalThis): SwitchApis {
  const c = root.chrome as
    | { action?: SwitchApis['action']; sidePanel?: SwitchApis['sidePanel'] }
    | undefined;
  // Bound calls: the browser functions need their namespace as `this`.
  const bind = <T extends object>(ns: T | undefined): T | undefined =>
    typeof ns === 'object' && ns !== null
      ? (Object.fromEntries(
          Object.keys(ns).map((k) => {
            const f = (ns as Record<string, unknown>)[k];
            return [k, typeof f === 'function' ? (f as (...a: unknown[]) => unknown).bind(ns) : f];
          }),
        ) as T)
      : undefined;
  return { action: bind(c?.action), sidePanel: bind(c?.sidePanel) };
}

/**
 * Switches between popup and side panel and makes the choice permanent.
 * From the popup `sidePanel.open` is called before anything is awaited: it needs the user gesture of the click.
 */
export async function switchView(deps: SwitchDeps): Promise<SwitchResult> {
  const { from, tabId, apis } = deps;
  if (from === 'popup') {
    let opened: Promise<void>;
    try {
      if (!apis.sidePanel?.open) throw new Error('sidePanel.open missing');
      opened = Promise.resolve(apis.sidePanel.open({ tabId }));
    } catch (e) {
      opened = Promise.reject(e);
    }
    const [open, saved] = await Promise.allSettled([opened, deps.save('sidepanel')]);
    if (saved.status === 'rejected') return 'save-failed';
    if (open.status === 'rejected') return 'failed';
    deps.closeSelf();
    return 'switched';
  }
  try {
    await deps.save('popup');
  } catch {
    return 'save-failed';
  }
  try {
    if (!apis.action?.openPopup) throw new Error('action.openPopup missing');
    // openPopup needs a popup document; the service worker sets it too, but may not have run yet.
    await apis.action.setPopup?.({ popup: deps.popupPath ?? FALLBACK_POPUP_PATH });
    await apis.action.openPopup();
  } catch {
    return 'failed';
  }
  try {
    if (!apis.sidePanel?.close) throw new Error('sidePanel.close missing');
    await apis.sidePanel.close({ tabId });
  } catch {
    deps.closeSelf();
  }
  return 'switched';
}
