import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../src/settings/schema';
import { PANEL_CLICK_TYPE, applyOpenAs, effectiveOpenAs, registerOpenAs, sidePanelSupported } from '../src/settings/openAs';

const fakes = () => {
  const calls: string[] = [];
  return {
    calls,
    apis: {
      action: { setPopup: vi.fn(async (d: { popup: string }) => void calls.push(`popup:${d.popup}`)) },
      sidePanel: {
        setPanelBehavior: vi.fn(async (b: { openPanelOnActionClick: boolean }) => void calls.push(`panel:${b.openPanelOnActionClick}`)),
        open: vi.fn(async (o: { tabId: number }) => void calls.push(`open:${o.tabId}`)),
      },
    },
  };
};

describe('applyOpenAs', () => {
  it('side panel: empty popup and no browser-opened panel', async () => {
    const f = fakes();
    await applyOpenAs('sidepanel', f.apis, 'popup.html');
    expect(f.calls).toEqual(['popup:', 'panel:false']);
  });

  it('popup: restores the popup path and stops opening the panel', async () => {
    const f = fakes();
    await applyOpenAs('popup', f.apis, 'popup.html');
    expect(f.calls).toEqual(['popup:popup.html', 'panel:false']);
  });

  it('without a side panel API the popup applies even if side panel is stored', async () => {
    const setPopup = vi.fn();
    await applyOpenAs('sidepanel', { action: { setPopup } }, 'popup.html');
    expect(setPopup).toHaveBeenCalledWith({ popup: 'popup.html' });
  });

  it('detects the API and falls back to popup without it', () => {
    expect(sidePanelSupported({})).toBe(false);
    expect(sidePanelSupported({ chrome: { sidePanel: {} } })).toBe(true);
    expect(effectiveOpenAs('sidepanel', false)).toBe('popup');
    expect(effectiveOpenAs('sidepanel', true)).toBe('sidepanel');
  });
});

describe('registerOpenAs', () => {
  function setup(stored: Settings) {
    const f = fakes();
    const handlers: Record<string, () => void> = {};
    let click: ((tab: { id?: number }) => void) | undefined;
    const notifyPanel = vi.fn(async (...args: unknown[]) => void args);
    let change: ((s: Settings) => void) | undefined;
    registerOpenAs({
      apis: f.apis,
      popupPath: 'popup.html',
      load: async () => stored,
      subscribe: (l) => ((change = l), () => {}),
      onInstalled: { addListener: (l) => void (handlers.installed = l) },
      onStartup: { addListener: (l) => void (handlers.startup = l) },
      onActionClicked: { addListener: (l) => void (click = l) },
      notifyPanel,
    });
    return { f, handlers, notifyPanel, click: (tab: { id?: number }) => click!(tab), emit: (s: Settings) => change!(s) };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('applies the stored value on install and on browser start', async () => {
    const { f, handlers } = setup({ ...DEFAULT_SETTINGS, openAs: 'sidepanel' });
    handlers.installed!();
    await flush();
    expect(f.calls).toEqual(['popup:', 'panel:false']);
    f.calls.length = 0;
    handlers.startup!();
    await flush();
    expect(f.calls).toEqual(['popup:', 'panel:false']);
  });

  it('applies the default popup on install without a stored choice', async () => {
    const { f, handlers } = setup(DEFAULT_SETTINGS);
    handlers.installed!();
    await flush();
    expect(f.calls).toEqual(['popup:popup.html', 'panel:false']);
  });

  it('applies both directions on settings change', async () => {
    const { f, emit } = setup(DEFAULT_SETTINGS);
    emit({ ...DEFAULT_SETTINGS, openAs: 'sidepanel' });
    await flush();
    expect(f.calls).toEqual(['popup:', 'panel:false']);
    emit({ ...DEFAULT_SETTINGS, openAs: 'popup' });
    await flush();
    expect(f.calls.slice(2)).toEqual(['popup:popup.html', 'panel:false']);
  });

  it('opens the panel on the toolbar click without awaiting anything first, then tells the panel', async () => {
    const { f, click, notifyPanel } = setup(DEFAULT_SETTINGS);
    click({ id: 7 });
    // Called synchronously: no promise was awaited before, so the user gesture is still valid.
    expect(f.apis.sidePanel.open).toHaveBeenCalledWith({ tabId: 7 });
    expect(notifyPanel).not.toHaveBeenCalled();
    await flush();
    expect(notifyPanel).toHaveBeenCalledWith({ type: PANEL_CLICK_TYPE, tabId: 7 });
  });

  it('swallows errors of open and of a missing panel, and ignores a click without tab id', async () => {
    const { f, click, notifyPanel } = setup(DEFAULT_SETTINGS);
    f.apis.sidePanel.open.mockRejectedValueOnce(new Error('x'));
    expect(() => click({ id: 1 })).not.toThrow();
    f.apis.sidePanel.open.mockImplementationOnce(() => {
      throw new Error('sync');
    });
    expect(() => click({ id: 2 })).not.toThrow();
    notifyPanel.mockRejectedValueOnce(new Error('no receiver'));
    click({ id: 3 });
    click({});
    await flush();
    expect(f.apis.sidePanel.open).toHaveBeenCalledTimes(3);
    expect(notifyPanel).toHaveBeenCalledTimes(1);
  });
});
