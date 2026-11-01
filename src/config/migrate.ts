import { ConfigError } from './errors';
import { CURRENT_SCHEMA_VERSION } from './schema';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Host names of the old URL prefixes, without "www."; unparseable prefixes are dropped (validation then reports an empty list). */
function prefixDomains(prefixes: unknown): string[] {
  if (!Array.isArray(prefixes)) return [];
  const hosts = prefixes.flatMap((p) => {
    try {
      return typeof p === 'string' ? [new URL(p).hostname.toLowerCase().replace(/^www\./, '')] : [];
    } catch {
      return [];
    }
  });
  return [...new Set(hosts)];
}

/**
 * v0 (pre-release shape): no schemaVersion; per project `urlPrefixes` (string[]) and
 * `selectors` (domain -> key -> selector); per field `schemaPath` instead of sources.
 */
function v0ToV1(input: Obj): Obj {
  const projects = input.projects;
  return {
    ...input,
    schemaVersion: 1,
    projects: Array.isArray(projects)
      ? projects.map((p: unknown) => {
          if (!isObj(p)) return p;
          const { urlPrefixes, selectors, fields, ...rest } = p;
          return {
            ...rest,
            scope: { allSites: false, domains: prefixDomains(urlPrefixes) },
            siteMappings: selectors ?? {},
            fields: Array.isArray(fields)
              ? fields.map((f: unknown) => {
                  if (!isObj(f)) return f;
                  const { schemaPath, ...frest } = f;
                  return { ...frest, sources: schemaPath === undefined ? {} : { schemaOrgPath: schemaPath } };
                })
              : fields,
          };
        })
      : projects,
  };
}

/** migrations[n] raises version n to n + 1. */
const migrations: ((input: Obj) => Obj)[] = [v0ToV1];

export function detectVersion(input: unknown): number {
  if (!isObj(input)) throw new ConfigError('Invalid configuration', ['(root): must be an object']);
  const v = input.schemaVersion;
  if (v === undefined) return 0;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    throw new ConfigError('Invalid configuration', ['schemaVersion: must be a non-negative integer']);
  }
  return v;
}

/** Raise any supported older state step by step to the current version (unvalidated). */
export function migrateConfig(input: unknown): unknown {
  let version = detectVersion(input);
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new ConfigError(
      `Unsupported configuration version ${version}: this extension supports up to version ${CURRENT_SCHEMA_VERSION}. Update the extension.`,
    );
  }
  let state = input as Obj;
  while (version < CURRENT_SCHEMA_VERSION) {
    const step = migrations[version];
    if (!step) throw new ConfigError(`No migration from version ${version}`);
    state = step(state);
    version += 1;
  }
  return state;
}
