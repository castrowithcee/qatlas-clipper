import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeScript = vi.hoisted(() => vi.fn<(opts: unknown) => Promise<unknown[]>>(async () => []));
vi.mock('wxt/browser', () => ({ browser: { scripting: { executeScript } } }));

import { startPicker } from '../src/picker/start';

beforeEach(() => executeScript.mockClear());

describe('startPicker', () => {
  it('injects /picker.js and then starts it with project and field', async () => {
    await startPicker(7, 'articles', 'title');
    expect(executeScript).toHaveBeenCalledTimes(2);
    expect(executeScript.mock.calls[0]![0]).toEqual({ target: { tabId: 7 }, files: ['/picker.js'] });
    const second = executeScript.mock.calls[1]![0] as { target: unknown; args: string[]; func: (...a: string[]) => void };
    expect(second.target).toEqual({ tabId: 7 });
    const start = vi.fn();
    (globalThis as Record<string, unknown>)[second.args[0]!] = start;
    second.func(...second.args);
    expect(start).toHaveBeenCalledWith('articles', 'title');
    delete (globalThis as Record<string, unknown>)[second.args[0]!];
  });

  it('propagates injection errors', async () => {
    executeScript.mockRejectedValueOnce(new Error('no access'));
    await expect(startPicker(1, 'a', 'b')).rejects.toThrow('no access');
  });
});
