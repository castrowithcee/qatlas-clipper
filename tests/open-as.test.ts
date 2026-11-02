import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../src/settings/schema';
import { applyOpenAs, effectiveOpenAs, registerOpenAs, sidePanelSupported } from '../src/settings/openAs';

const fakes = () => {
  const calls: string[] = [];
  return {
    calls,
    apis: {
      action: { setPopup: vi.fn(async (d: { popup: string }) => void calls.push(`popup:${d.popup}`)) },
      sidePanel: { setPanelBehavior: vi.fn(async (b: { openPanelOnActionClick: boolean }) => void calls.push(`panel:${b.openPanelOnActionClick}`)) },
    },
  };
};

describe('applyOpenAs', () => {
  it('side panel: empty popup and open on click', async () => {
    const f = fakes();
    await applyOpenAs('sidepanel', f.apis, 'popup.html');
    expect(f.calls).toEqual(['popup:', 'panel:true']);
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
    let change: ((s: Settings) => void) | undefined;
    registerOpenAs({
      apis: f.apis,
      popupPath: 'popup.html',
      load: async () => stored,
      subscribe: (l) => ((change = l), () => {}),
      onInstalled: { addListener: (l) => void (handlers.installed = l) },
      onStartup: { addListener: (l) => void (handlers.startup = l) },
    });
    return { f, handlers, emit: (s: Settings) => change!(s) };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('applies the stored value on install and on browser start', async () => {
    const { f, handlers } = setup({ ...DEFAULT_SETTINGS, openAs: 'sidepanel' });
    handlers.installed!();
    await flush();
    expect(f.calls).toEqual(['popup:', 'panel:true']);
    f.calls.length = 0;
    handlers.startup!();
    await flush();
    expect(f.calls).toEqual(['popup:', 'panel:true']);
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
    expect(f.calls).toEqual(['popup:', 'panel:true']);
    emit({ ...DEFAULT_SETTINGS, openAs: 'popup' });
    await flush();
    expect(f.calls.slice(2)).toEqual(['popup:popup.html', 'panel:false']);
  });
});
