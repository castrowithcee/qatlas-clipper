import { ConfigError, parseConfig, type Config, type Field, type Project, type Scope } from '../config';

export const newId = (): string => crypto.randomUUID();

export function moveItem<T>(items: T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item as T);
  return next;
}

export function newProject(): Project {
  return { id: newId(), name: 'New project', scope: { allSites: true, domains: [] }, fields: [], siteMappings: {}, targets: [] };
}

export function newField(existing: Field[]): Field {
  const keys = new Set(existing.map((f) => f.key));
  let n = existing.length + 1;
  while (keys.has(`field${n}`)) n++;
  return { key: `field${n}`, label: 'New field', required: false, sources: {} };
}

/** Switching to "all sites" drops the domain list; switching to "domains" starts with one empty entry. */
export function setAllSites(scope: Scope, allSites: boolean): Scope {
  if (allSites === scope.allSites) return scope;
  return { ...scope, allSites, domains: allSites ? [] : [''] };
}

/**
 * Rename a field key. Site-mapping entries follow the field, unless the new key already
 * belongs to another field; then they stay under the old key and validation reports them.
 */
export function renameFieldKey(project: Project, index: number, key: string): Project {
  const old = project.fields[index]?.key;
  const fields = project.fields.map((f, i) => (i === index ? { ...f, key } : f));
  if (old === undefined || old === key || project.fields.some((f, i) => i !== index && f.key === key)) {
    return { ...project, fields };
  }
  const siteMappings: Project['siteMappings'] = {};
  for (const [domain, map] of Object.entries(project.siteMappings)) {
    siteMappings[domain] = Object.fromEntries(Object.entries(map).map(([k, sel]) => [k === old ? key : k, sel]));
  }
  return { ...project, fields, siteMappings };
}

export function deleteField(project: Project, index: number): Project {
  const key = project.fields[index]?.key;
  const siteMappings: Project['siteMappings'] = {};
  for (const [domain, map] of Object.entries(project.siteMappings)) {
    const kept = Object.entries(map).filter(([k]) => k !== key || project.fields.some((f, i) => i !== index && f.key === k));
    if (kept.length > 0) siteMappings[domain] = Object.fromEntries(kept);
  }
  return { ...project, fields: project.fields.filter((_, i) => i !== index), siteMappings };
}

export function deleteMapping(project: Project, domain: string, key: string): Project {
  const { [key]: _removed, ...rest } = project.siteMappings[domain] ?? {};
  void _removed;
  const siteMappings = { ...project.siteMappings };
  if (Object.keys(rest).length > 0) siteMappings[domain] = rest;
  else delete siteMappings[domain];
  return { ...project, siteMappings };
}

export function deleteDomain(project: Project, domain: string): Project {
  const siteMappings = { ...project.siteMappings };
  delete siteMappings[domain];
  return { ...project, siteMappings };
}

/** Trim the scope and drop unused optional sources so that "empty input" means "not used". */
export function normalize(config: Config): Config {
  return {
    ...config,
    projects: config.projects.map((p) => {
      const { pageType, ...scope } = p.scope;
      const trimmed = pageType?.trim();
      return {
        ...p,
        scope: {
          ...scope,
          domains: scope.domains.map((d) => d.trim()),
          ...(trimmed ? { pageType: trimmed } : {}),
        },
        fields: p.fields.map((f) => {
          const sources: Field['sources'] = { ...f.sources };
          if (sources.schemaOrgPath !== undefined && sources.schemaOrgPath.trim() === '') delete sources.schemaOrgPath;
          if (sources.metaTag && sources.metaTag.name.trim() === '') delete sources.metaTag;
          if (sources.manual?.type === 'choice') {
            sources.manual = { type: 'choice', values: sources.manual.values.map((v) => v.trim()).filter(Boolean) };
          }
          return { ...f, sources };
        }),
      };
    }),
  };
}

export interface Issue {
  path: string;
  message: string;
}

export function validate(config: Config): Issue[] {
  try {
    parseConfig(normalize(config));
    return [];
  } catch (e) {
    if (e instanceof ConfigError) return e.issues.map(splitIssue);
    throw e;
  }
}

export function splitIssue(raw: string): Issue {
  const i = raw.indexOf(': ');
  return i < 0 ? { path: '(root)', message: raw } : { path: raw.slice(0, i), message: raw.slice(i + 2) };
}

export const errorsAt = (issues: Issue[], path: string): string[] =>
  issues.filter((i) => i.path === path).map((i) => i.message);

// Paths that an input of the project editor shows itself.
const MAPPED = /^projects\[(\d+)\]\.(name|scope\.(pageType|domains\[\d+\]|domains)|fields\[\d+\]\.(key|label|sources\.schemaOrgPath|sources\.metaTag\.name|sources\.manual\.values(\[\d+\])?)|siteMappings\..+)$/;

/** Issues that no visible input of the selected project shows. */
export function unmappedIssues(issues: Issue[], selectedIndex: number): Issue[] {
  return issues.filter((i) => {
    const m = MAPPED.exec(i.path);
    return !m || Number(m[1]) !== selectedIndex;
  });
}
