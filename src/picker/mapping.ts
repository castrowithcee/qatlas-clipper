import { ConfigError, loadConfig, saveConfig, type Config, type StorageArea } from '../config';

/** Lowercase hostname without one leading "www." (matches the lookup in extract/findSelector). Only http/https. */
export function normalizeDomain(pageUrl: string): string {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    throw new ConfigError('Page URL is not valid');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigError('Mapping is only possible on http and https pages');
  }
  const host = url.hostname.toLowerCase();
  return host.startsWith('www.') ? host.slice(4) : host;
}

/** Store selector for projectId/domain/fieldKey; replaces the same field on that domain, keeps everything else. */
export async function saveMapping(
  input: { projectId: string; fieldKey: string; pageUrl: string; selector: string },
  storage?: StorageArea,
): Promise<Config> {
  const domain = normalizeDomain(input.pageUrl);
  const config = await loadConfig(storage);
  const project = config.projects.find((p) => p.id === input.projectId);
  if (!project) throw new ConfigError(`Unknown project "${input.projectId}"`);
  if (!project.fields.some((f) => f.key === input.fieldKey)) {
    throw new ConfigError(`Unknown field "${input.fieldKey}" in project "${input.projectId}"`);
  }
  const existing = Object.hasOwn(project.siteMappings, domain) ? project.siteMappings[domain] : {};
  const next: Config = {
    ...config,
    projects: config.projects.map((p) =>
      p === project
        ? { ...p, siteMappings: { ...p.siteMappings, [domain]: { ...existing, [input.fieldKey]: input.selector } } }
        : p,
    ),
  };
  return saveConfig(next, storage);
}
