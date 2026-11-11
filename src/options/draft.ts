import { ConfigError, newId, parseConfig, type Config, type Field, type Folder, type Project, type Tag, type Scope, type Target } from '../config';

export { newId };

export function moveItem<T>(items: T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item as T);
  return next;
}

/** Moves the item at `from` so that it ends up at index `to`. */
export function moveTo<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

/**
 * Carries row identities from one version of a list to the next, for items without an id of their own:
 * the same object keeps its id, then an item with the same key, then the item at the same position.
 */
export function followIds<T extends { key: string }>(prev: readonly T[], prevIds: readonly string[], next: readonly T[], fresh: (item: T) => string): string[] {
  const free = new Set(prev.map((_, j) => j));
  const ids: (string | undefined)[] = next.map(() => undefined);
  const take = (i: number, match: (p: T, j: number) => boolean) => {
    if (ids[i] !== undefined) return;
    const j = prev.findIndex((p, k) => free.has(k) && match(p, k));
    if (j < 0) return;
    free.delete(j);
    ids[i] = prevIds[j];
  };
  next.forEach((item, i) => take(i, (p) => p === item));
  next.forEach((item, i) => take(i, (p) => p.key === item.key));
  next.forEach((_, i) => take(i, (_p, j) => j === i));
  return ids.map((id, i) => id ?? fresh(next[i] as T));
}

/** Host and the start of the path for a list cell; query and fragment are left out, the full address belongs in a tooltip. */
export function shortAddress(url: string, max = 36): string {
  const text = url.trim();
  let short: string;
  try {
    const u = new URL(text);
    short = u.host + (u.pathname === '/' ? '' : u.pathname);
  } catch {
    short = text.replace(/[?#].*$/, '');
  }
  return short.length > max ? `${short.slice(0, max - 1)}…` : short;
}

export function newProject(name: string): Project {
  return { id: newId(), name, scope: { allSites: true, domains: [] }, fields: [], siteMappings: {}, targets: [], content: 'markdown' };
}

export function newTarget(name: string): Target {
  return { id: newId(), name, url: 'https://', headers: [], purpose: '' };
}

export function addFolder(config: Config, name: string): Config {
  return { ...config, folders: [...(config.folders ?? []), { id: newId(), name }] };
}

export function renameFolder(config: Config, id: string, name: string): Config {
  return { ...config, folders: (config.folders ?? []).map((f) => (f.id === id ? { ...f, name } : f)) };
}

/** Moves the folder at index `from` to index `to` in the display order. */
export function moveFolder(config: Config, from: number, to: number): Config {
  return { ...config, folders: moveTo(config.folders ?? [], from, to) };
}

/** Projects of the deleted folder stay and only lose their folder. */
export function deleteFolder(config: Config, id: string): Config {
  const projects = config.projects.map((p) => {
    if (p.folderId !== id) return p;
    const { folderId: _gone, ...rest } = p;
    void _gone;
    return rest;
  });
  return { ...config, folders: (config.folders ?? []).filter((f) => f.id !== id), projects };
}

type NameError = 'missing' | 'tooLong' | 'taken' | undefined;

export function nameErrorIn(list: { id: string; name: string }[], name: string, exceptId?: string): NameError {
  const trimmed = name.trim();
  if (trimmed === '') return 'missing';
  if (trimmed.length > 60) return 'tooLong';
  const key = trimmed.toLowerCase();
  return list.some((f) => f.id !== exceptId && f.name.trim().toLowerCase() === key) ? 'taken' : undefined;
}

/** Why a folder name cannot be used (blank, too long, or taken by another folder, ignoring case); `undefined` if fine. */
export function folderNameError(config: Config, name: string, exceptId?: string): NameError {
  return nameErrorIn(config.folders ?? [], name, exceptId);
}

/** Same rules as for folders, applied to the tag list. */
export function tagNameError(config: Config, name: string, exceptId?: string): NameError {
  return nameErrorIn(config.tags ?? [], name, exceptId);
}

/** Number of projects that carry the tag. */
export function tagUsage(config: Config, id: string): number {
  return config.projects.filter((p) => p.tagIds?.includes(id)).length;
}

/** Creates the tag and assigns it to the project in one step. */
export function addTagToProject(config: Config, projectId: string, name: string): Config {
  const tag = { id: newId(), name };
  return {
    ...config,
    tags: [...(config.tags ?? []), tag],
    projects: config.projects.map((p) => (p.id === projectId ? setProjectTags(p, [...(p.tagIds ?? []), tag.id]) : p)),
  };
}

/** `undefined` takes the project out of its folder. */
export function setProjectFolder(project: Project, folderId: string | undefined): Project {
  const { folderId: _old, ...rest } = project;
  void _old;
  return folderId === undefined ? rest : { ...rest, folderId };
}

export function addTag(config: Config, name: string): Config {
  return { ...config, tags: [...(config.tags ?? []), { id: newId(), name }] };
}

export function renameTag(config: Config, id: string, name: string): Config {
  return { ...config, tags: (config.tags ?? []).map((t) => (t.id === id ? { ...t, name } : t)) };
}

/** Removes the tag and its id from all projects. */
export function deleteTag(config: Config, id: string): Config {
  const projects = config.projects.map((p) => {
    if (!p.tagIds?.includes(id)) return p;
    const tagIds = p.tagIds.filter((t) => t !== id);
    const { tagIds: _old, ...rest } = p;
    void _old;
    return tagIds.length > 0 ? { ...rest, tagIds } : rest;
  });
  return { ...config, tags: (config.tags ?? []).filter((t) => t.id !== id), projects };
}

/** An empty list removes the key, so a project without tags looks like one that never had any. */
export function setProjectTags(project: Project, tagIds: string[]): Project {
  const { tagIds: _old, ...rest } = project;
  void _old;
  return tagIds.length === 0 ? rest : { ...rest, tagIds: [...new Set(tagIds)] };
}

const TRANSLITERATION: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', đ: 'd', ł: 'l', þ: 'th' };

/** Same rule as the `key` of the field schema. */
export const isValidFieldKey = (key: string): boolean => /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(key);

/**
 * Derives a field key from a label: lowercase ASCII with underscores (umlauts become ae, oe, ue, ss),
 * made unique among `taken` with a numeric suffix. A label without any ASCII letter or digit gives "field".
 */
export function fieldKeyFromLabel(label: string, taken: readonly string[]): string {
  const base =
    label
      .toLowerCase()
      .replace(/[äöüßæœøđłþ]/g, (c) => TRANSLITERATION[c] ?? c)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 56)
      .replace(/_+$/, '') || 'field';
  let key = base;
  for (let n = 2; taken.includes(key); n++) key = `${base}_${n}`;
  return key;
}

/** The key is derived once, here; renaming the label later leaves it alone. */
export function newField(existing: Field[], label: string): Field {
  const trimmed = label.trim();
  return { key: fieldKeyFromLabel(trimmed, existing.map((f) => f.key)), label: trimmed, required: false, format: 'text', sources: {} };
}

export type ValueWay = 'detect' | 'click' | 'manual';

/** Where a field's value comes from; the technical sources (schema.org path, meta tag) work alongside any of them. */
export function valueWay(field: Field): ValueWay {
  return field.sources.detect ? 'detect' : field.sources.manual ? 'manual' : 'click';
}

export function setValueWay(field: Field, way: ValueWay): Field {
  if (valueWay(field) === way) return field;
  const { detect: _detect, manual, ...rest } = field.sources;
  void _detect;
  if (way === 'detect') return { ...field, sources: { ...rest, detect: 'title' } };
  if (way === 'manual') return { ...field, sources: { ...rest, manual: manual ?? { type: 'text' } } };
  return { ...field, sources: rest };
}

/** Switching to "all sites" drops the domain list; switching to specific sites starts with an empty list. */
export function setAllSites(scope: Scope, allSites: boolean): Scope {
  if (allSites === scope.allSites) return scope;
  return { ...scope, allSites, domains: [] };
}

const HOSTNAME = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * Turns a typed host name or a pasted address into the domain stored in the scope:
 * lowercase, without scheme, path, port and a leading "www.". Undefined if no valid host name remains.
 */
export function parseWebsite(input: string): string | undefined {
  const text = input.trim();
  if (text === '' || /\s/.test(text)) return undefined;
  let host: string;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`).hostname;
  } catch {
    return undefined;
  }
  host = host.toLowerCase().replace(/^www\./, '');
  return HOSTNAME.test(host) ? host : undefined;
}

/** `undefined` removes the key, since an absent page kind means "any page". */
export function setPageKind(scope: Scope, kind: Scope['pageKind'] | undefined): Scope {
  const { pageKind: _old, ...rest } = scope;
  void _old;
  return kind ? { ...rest, pageKind: kind } : rest;
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

/** The websites with a saved click mapping for a field key, with their selector. */
export function mappedSites(project: Pick<Project, 'siteMappings'>, key: string): [site: string, selector: string][] {
  return Object.entries(project.siteMappings).flatMap(([site, map]) => (Object.hasOwn(map, key) ? [[site, map[key] as string] as [string, string]] : []));
}

/** Mappings whose key belongs to no field, e.g. after renaming a key onto one that was taken. */
export function orphanMappings(project: Pick<Project, 'siteMappings' | 'fields'>): { site: string; key: string }[] {
  const keys = new Set(project.fields.map((f) => f.key));
  return Object.entries(project.siteMappings).flatMap(([site, map]) => Object.keys(map).filter((k) => !keys.has(k)).map((key) => ({ site, key })));
}

/** Trim the scope and drop unused optional sources so that "empty input" means "not used". */
export function normalize(config: Config): Config {
  const trimName = <T extends Folder | Tag>(item: T): T => ({ ...item, name: item.name.trim() });
  return {
    ...config,
    ...(config.folders && { folders: config.folders.map(trimName) }),
    ...(config.tags && { tags: config.tags.map(trimName) }),
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
        targets: p.targets.map((t) => ({ ...t, url: t.url.trim(), headers: t.headers.map((h) => h.trim()) })),
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

// Paths that the project editor shows itself: at an input, at a marked field row (whose details hold the input)
// or, for site mappings, in the details of their field or in the warning line of a mapping without field.
const MAPPED = /^projects\[(\d+)\]\.(name|scope\.(pageType|domains\[\d+\]|domains)|fields\[\d+\]\.(key|label|sources\.schemaOrgPath|sources\.metaTag\.name|sources\.manual\.values(\[\d+\])?)|folderId|tagIds(\[\d+\])?|siteMappings\..+|targets\[\d+\]\.(name|url|purpose|headers\[\d+\]))$/;

/** Issues that no visible input of the selected project shows. */
export function unmappedIssues(issues: Issue[], selectedIndex: number): Issue[] {
  return issues.filter((i) => {
    const m = MAPPED.exec(i.path);
    return !m || Number(m[1]) !== selectedIndex;
  });
}
