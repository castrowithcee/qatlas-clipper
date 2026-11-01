import { browser } from 'wxt/browser';
import { ConfigError } from './errors';
import { migrateConfig } from './migrate';
import {
  CURRENT_SCHEMA_VERSION,
  headerValuesSchema,
  parseConfig,
  type Config,
  type HeaderValues,
} from './schema';

export const CONFIG_KEY = 'config';
export const HEADER_VALUES_KEY = 'headerValues';

/** Subset of chrome.storage.local; injectable for tests. */
export interface StorageArea {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export const defaultStorage = (): StorageArea => browser.storage.local as unknown as StorageArea;

export const emptyConfig = (): Config => ({ schemaVersion: CURRENT_SCHEMA_VERSION, projects: [] });

/** Drop values of removed targets and of header names a target no longer declares. */
export function pruneHeaderValues(config: Config, values: HeaderValues): HeaderValues {
  const out: HeaderValues = {};
  for (const target of config.projects.flatMap((p) => p.targets)) {
    const kept = Object.entries(values[target.id] ?? {}).filter(([name]) => target.headers.includes(name));
    if (kept.length > 0) out[target.id] = Object.fromEntries(kept);
  }
  return out;
}

function parseHeaderValues(raw: unknown): HeaderValues {
  if (raw === undefined) return {};
  const r = headerValuesSchema.safeParse(raw);
  if (!r.success) throw new ConfigError('Stored header values are invalid (values not shown)');
  return r.data;
}

/** Load stored config (migrated in memory, validated). Throws ConfigError on invalid data; never returns a partial state. */
export async function loadConfig(storage: StorageArea = defaultStorage()): Promise<Config> {
  const stored = (await storage.get([CONFIG_KEY]))[CONFIG_KEY];
  if (stored === undefined) return emptyConfig();
  return parseConfig(migrateConfig(stored), 'Stored configuration is invalid');
}

export async function loadHeaderValues(storage: StorageArea = defaultStorage()): Promise<HeaderValues> {
  return parseHeaderValues((await storage.get([HEADER_VALUES_KEY]))[HEADER_VALUES_KEY]);
}

/**
 * Validate and replace the config. Header values for still-present targets/names are kept,
 * the rest is removed. Both keys are written in one call so they cannot diverge.
 */
export async function saveConfig(input: unknown, storage: StorageArea = defaultStorage()): Promise<Config> {
  const config = parseConfig(input);
  const values = pruneHeaderValues(config, await loadHeaderValues(storage));
  await storage.set({ [CONFIG_KEY]: config, [HEADER_VALUES_KEY]: values });
  return config;
}

/** Set one header value; the target and header name must be declared in the stored config. */
export async function setHeaderValue(
  targetId: string,
  headerName: string,
  value: string,
  storage: StorageArea = defaultStorage(),
): Promise<void> {
  const config = await loadConfig(storage);
  const target = config.projects.flatMap((p) => p.targets).find((t) => t.id === targetId);
  if (!target) throw new ConfigError(`Unknown target "${targetId}"`);
  if (!target.headers.includes(headerName)) {
    throw new ConfigError(`Target "${targetId}" does not declare header "${headerName}"`);
  }
  const values = await loadHeaderValues(storage);
  values[targetId] = { ...values[targetId], [headerName]: value };
  await storage.set({ [HEADER_VALUES_KEY]: values });
}
