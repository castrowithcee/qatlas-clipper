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
