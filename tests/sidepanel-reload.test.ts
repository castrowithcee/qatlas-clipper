import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchPanelReload, type PanelEvents } from '../src/popup/sidePanelReload';

vi.mock('wxt/browser', () => ({ browser: {} }));

function source<A extends unknown[]>() {
  const listeners = new Set<(...a: A) => void>();
  return {
    addListener: (l: (...a: A) => void) => void listeners.add(l),
    removeListener: (l: (...a: A) => void) => void listeners.delete(l),
    emit: (...a: A) => listeners.forEach((l) => l(...a)),
    size: () => listeners.size,
  };
}

function setup(pinnedTabId?: number) {
  const events = {
    storageChanged: source<[Record<string, unknown>, string]>(),
    tabActivated: source<[{ tabId: number; windowId: number }]>(),
    tabUpdated: source<[number, { url?: string; status?: string }, { windowId?: number; active?: boolean }]>(),
  };
  const onReload = vi.fn();
  const stop = watchPanelReload(events as unknown as PanelEvents, { windowId: () => 1, pinnedTabId, onReload, delayMs: 100 });
  return { events, onReload, stop };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('watchPanelReload', () => {
  it('reloads at once on a config change in local storage only', () => {
    const { events, onReload } = setup();
    events.storageChanged.emit({ other: {} }, 'local');
    events.storageChanged.emit({ config: {} }, 'session');
    expect(onReload).not.toHaveBeenCalled();
    events.storageChanged.emit({ config: {} }, 'local');
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('reloads when a tab of its own window is activated, not for other windows', () => {
    const { events, onReload } = setup();
    events.tabActivated.emit({ tabId: 5, windowId: 2 });
    expect(onReload).not.toHaveBeenCalled();
    events.tabActivated.emit({ tabId: 5, windowId: 1 });
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('reloads on url change or completed loading of the active tab, ignoring other updates', () => {
    const { events, onReload } = setup();
    events.tabUpdated.emit(5, { url: 'https://example.com/' }, { windowId: 2, active: true });
    events.tabUpdated.emit(5, { url: 'https://example.com/' }, { windowId: 1, active: false });
    events.tabUpdated.emit(5, { status: 'loading' }, { windowId: 1, active: true });
    events.tabUpdated.emit(5, {}, { windowId: 1, active: true });
    expect(onReload).not.toHaveBeenCalled();
    events.tabUpdated.emit(5, { status: 'complete' }, { windowId: 1, active: true });
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('coalesces a burst into the first and one trailing reload', () => {
    const { events, onReload } = setup();
    for (let i = 0; i < 6; i++) events.tabUpdated.emit(5, { url: `https://example.com/${i}` }, { windowId: 1, active: true });
    expect(onReload).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    expect(onReload).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000);
    expect(onReload).toHaveBeenCalledTimes(2);
  });

  it('follows only the pinned tab when one is set', () => {
    const { events, onReload } = setup(9);
    events.tabActivated.emit({ tabId: 5, windowId: 1 });
    events.tabUpdated.emit(5, { status: 'complete' }, { windowId: 1, active: true });
    expect(onReload).not.toHaveBeenCalled();
    events.tabUpdated.emit(9, { status: 'complete' }, { windowId: 1, active: false });
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes', () => {
    const { events, onReload, stop } = setup();
    stop();
    expect(events.storageChanged.size() + events.tabActivated.size() + events.tabUpdated.size()).toBe(0);
    events.storageChanged.emit({ config: {} }, 'local');
    expect(onReload).not.toHaveBeenCalled();
  });
});
