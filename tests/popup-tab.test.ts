import { describe, expect, it, vi } from 'vitest';
import { resolveTab } from '../src/popup/PopupApp';

const api = () => ({
  active: vi.fn(async () => ({ id: 1, url: 'https://example.com/active' })),
  byId: vi.fn(async (id: number) => ({ id, url: 'https://example.com/by-id' })),
});

describe('popup tab resolution', () => {
  it('uses the tabId parameter only when enabled', async () => {
    const a = api();
    expect(await resolveTab(true, '?tabId=42', a)).toEqual({ id: 42, url: 'https://example.com/by-id' });
    expect(a.active).not.toHaveBeenCalled();
  });

  it('ignores the parameter when disabled', async () => {
    const a = api();
    expect((await resolveTab(false, '?tabId=42', a))?.id).toBe(1);
    expect(a.byId).not.toHaveBeenCalled();
  });

  it('falls back to the active tab for a missing or malformed parameter in e2e', async () => {
    for (const search of ['', '?tabId=', '?tabId=abc', '?tabId=-1', '?tabId=1.5']) {
      const a = api();
      expect((await resolveTab(true, search, a))?.id).toBe(1);
      expect(a.byId).not.toHaveBeenCalled();
    }
  });
});
