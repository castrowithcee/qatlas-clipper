import { browser } from 'wxt/browser';

// Must match PICKER_GLOBAL in entrypoints/picker.ts (not imported: the entrypoint file is bundled separately).
const PICKER_GLOBAL = '__qatlasPickerStart';

/** Injects the picker script into the tab (activeTab grant required) and starts it for one field. */
export async function startPicker(tabId: number, projectId: string, fieldKey: string): Promise<void> {
  await browser.scripting.executeScript({ target: { tabId }, files: ['/picker.js'] });
  await browser.scripting.executeScript({
    target: { tabId },
    args: [PICKER_GLOBAL, projectId, fieldKey],
    func: (globalName: string, p: string, f: string) => {
      const start = (globalThis as Record<string, unknown>)[globalName];
      if (typeof start === 'function') (start as (a: string, b: string) => void)(p, f);
    },
  });
}
