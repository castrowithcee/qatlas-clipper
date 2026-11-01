import { browser } from 'wxt/browser';
import { defaultStorage, type StorageArea } from '../config';
import { parseSettings, type Settings } from './schema';

/** Own key, never part of the exportable configuration. */
export const SETTINGS_KEY = 'settings';

export async function loadSettings(storage: StorageArea = defaultStorage()): Promise<Settings> {
  return parseSettings((await storage.get([SETTINGS_KEY]))[SETTINGS_KEY]);
}

export async function saveSettings(settings: Settings, storage: StorageArea = defaultStorage()): Promise<Settings> {
  const valid = parseSettings(settings);
  await storage.set({ [SETTINGS_KEY]: valid });
  return valid;
}

/** Calls back with the new settings when another context changed them. Returns the unsubscribe function. */
export function subscribeSettings(onChange: (settings: Settings) => void): () => void {
  const events = browser.storage?.onChanged;
  if (!events) return () => {};
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && SETTINGS_KEY in changes) onChange(parseSettings(changes[SETTINGS_KEY]?.newValue));
  };
  events.addListener(listener);
  return () => events.removeListener(listener);
}
