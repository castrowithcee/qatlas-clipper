import { browser } from 'wxt/browser';
import { ConfigError } from './errors';
import { migrateConfig } from './migrate';
import { parseConfig, type Config } from './schema';
import { defaultStorage, loadConfig, saveConfig, type StorageArea } from './storage';

export const MAX_IMPORT_CHARS = 1_000_000;

/** Export contains only the config (header names, never values). */
export async function exportConfig(storage: StorageArea = defaultStorage()): Promise<string> {
  const config = await loadConfig(storage);
  return JSON.stringify(config, null, 2);
}

/**
 * Parse untrusted JSON text into a validated config without storing it.
 * Imported header values are REJECTED, not stripped: the schema is strict, so any unknown
 * key (e.g. header values, or string headers with values) fails with its path.
 */
export function parseImportText(text: string): Config {
  if (text.length > MAX_IMPORT_CHARS) throw new ConfigError('Import is too large');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ConfigError('Import is not valid JSON');
  }
  return parseConfig(migrateConfig(data), 'Invalid import');
}

/** Replace the whole config with imported text. Header values of same-ID targets are kept. */
export async function importFromText(text: string, storage: StorageArea = defaultStorage()): Promise<Config> {
  return saveConfig(parseImportText(text), storage);
}

export interface UrlImportDeps {
  storage?: StorageArea;
  hasPermission?: (origin: string) => Promise<boolean>;
  fetch?: typeof fetch;
}

const defaultHasPermission = (originPattern: string) => browser.permissions.contains({ origins: [originPattern] });

export async function importFromUrl(url: string, deps: UrlImportDeps = {}): Promise<Config> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ConfigError('Import URL is not a valid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ConfigError('Import URL must use http: or https:');
  }
  const pattern = `${parsed.origin}/*`;
  if (!(await (deps.hasPermission ?? defaultHasPermission)(pattern))) {
    throw new ConfigError(`No host permission for ${parsed.origin}; grant it before importing from this URL`);
  }
  let text: string;
  try {
    // No credentials, and no redirects: a redirect could leave the permitted origin.
    const res = await (deps.fetch ?? fetch)(parsed.href, { credentials: 'omit', redirect: 'error' });
    if (!res.ok) throw new ConfigError(`Import URL answered with HTTP ${res.status}`);
    text = await res.text();
  } catch (e) {
    if (e instanceof ConfigError) throw e;
    throw new ConfigError(`Could not fetch import URL from ${parsed.origin}`);
  }
  return importFromText(text, deps.storage);
}
