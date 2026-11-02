import type { Settings } from './schema';

type OpenAs = Settings['openAs'];

export interface OpenAsApis {
  action: { setPopup(details: { popup: string }): Promise<void> | void };
  /** Missing in browsers without a side panel. */
  sidePanel?: { setPanelBehavior(behavior: { openPanelOnActionClick: boolean }): Promise<void> | void };
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
    // An empty popup lets the click reach the side panel behavior.
    await apis.action.setPopup({ popup: '' });
    await apis.sidePanel!.setPanelBehavior({ openPanelOnActionClick: true });
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
}

/** Applies the setting on install, browser start and every change. Failures are swallowed: the previous behavior stays. */
export function registerOpenAs(deps: RegisterOpenAsDeps): { apply: () => Promise<void> } {
  const run = (openAs: OpenAs) => applyOpenAs(openAs, deps.apis, deps.popupPath).catch(() => undefined);
  const apply = async () => run((await deps.load().catch(() => ({ openAs: 'popup' as const }))).openAs);
  deps.onInstalled.addListener(() => void apply());
  deps.onStartup.addListener(() => void apply());
  deps.subscribe((s) => void run(s.openAs));
  return { apply };
}
