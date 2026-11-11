import { z } from 'zod';
import { ConfigError } from './errors';
import { newId } from './id';
import { MAX_IMPORT_CHARS } from './importExport';
import { migrateConfig } from './migrate';
import {
  CURRENT_SCHEMA_VERSION,
  formatPath,
  parseConfig,
  type Config,
  type Folder,
  type HeaderValues,
  type Project,
  type Tag,
} from './schema';
import { pruneHeaderValues, updateStored, type StorageArea, type StoredState } from './storage';

export const SHARE_FORMAT = 'qatlas-clipper-share';
export const SHARE_SCHEMA_VERSION = 1;

/** A share file: selected projects with the folders and tags they use. Header values are never part of it. */
export interface ShareFile {
  format: typeof SHARE_FORMAT;
  schemaVersion: typeof SHARE_SCHEMA_VERSION;
  /** False means every project has `targets: []`. */
  targetsIncluded: boolean;
  folders: Folder[];
  tags: Tag[];
  projects: Project[];
}

export interface ShareSelection {
  projectIds: string[];
  /** A chosen folder includes all its projects, and itself even when empty. */
  folderIds: string[];
  includeTargets: boolean;
}

const unknownIds = (wanted: string[], known: { id: string }[]): boolean => {
  const ids = new Set(known.map((k) => k.id));
  return wanted.some((w) => !ids.has(w));
};

/** Builds a share file from the stored config; order follows the config. Never contains header values. */
export function buildShare(config: Config, selection: ShareSelection): ShareFile {
  const folders = config.folders ?? [];
  const tags = config.tags ?? [];
  if (unknownIds(selection.projectIds, config.projects)) throw new ConfigError('Unknown project in the selection');
  if (unknownIds(selection.folderIds, folders)) throw new ConfigError('Unknown folder in the selection');
  const projectIds = new Set(selection.projectIds);
  const chosenFolders = new Set(selection.folderIds);
  const projects = config.projects
    .filter((p) => projectIds.has(p.id) || (p.folderId !== undefined && chosenFolders.has(p.folderId)))
    .map((p) => structuredClone(selection.includeTargets ? p : { ...p, targets: [] }));
  const usedFolders = new Set([...chosenFolders, ...projects.flatMap((p) => (p.folderId === undefined ? [] : [p.folderId]))]);
  const usedTags = new Set(projects.flatMap((p) => p.tagIds ?? []));
  return {
    format: SHARE_FORMAT,
    schemaVersion: SHARE_SCHEMA_VERSION,
    targetsIncluded: selection.includeTargets,
    folders: structuredClone(folders.filter((f) => usedFolders.has(f.id))),
    tags: structuredClone(tags.filter((t) => usedTags.has(t.id))),
    projects,
  };
}

/** Serialized share file. */
export const stringifyShare = (share: ShareFile): string => JSON.stringify(share, null, 2);

const envelopeSchema = z.strictObject({
  format: z.literal(SHARE_FORMAT),
  schemaVersion: z.literal(SHARE_SCHEMA_VERSION),
  targetsIncluded: z.boolean(),
  folders: z.array(z.unknown()),
  tags: z.array(z.unknown()),
  projects: z.array(z.unknown()),
});

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Parses untrusted text into a validated share file; nothing is stored or executed. Also accepts a backup of the whole
 * config (then `targetsIncluded` is true). Messages name paths, never input values.
 */
export function parseShareText(text: string): ShareFile {
  if (text.length > MAX_IMPORT_CHARS) throw new ConfigError('Import is too large');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ConfigError('Import is not valid JSON');
  }
  if (!isObj(data)) throw new ConfigError('Invalid import', ['(root): must be an object']);
  if (!('format' in data)) {
    const config = parseConfig(migrateConfig(data), 'Invalid import');
    return {
      format: SHARE_FORMAT,
      schemaVersion: SHARE_SCHEMA_VERSION,
      targetsIncluded: true,
      folders: config.folders ?? [],
      tags: config.tags ?? [],
      projects: config.projects,
    };
  }
  if (data.schemaVersion === undefined) throw new ConfigError('Invalid import', ['schemaVersion: is required']);
  migrateConfig(data); // throws for a higher or malformed version
  const envelope = envelopeSchema.safeParse(data);
  if (!envelope.success) {
    throw new ConfigError(
      'Invalid import',
      envelope.error.issues.map((i) => `${formatPath(i.path)}: ${i.code === 'unrecognized_keys' ? 'unknown key(s) are not allowed' : i.message}`),
    );
  }
  const e = envelope.data;
  const config = parseConfig({ schemaVersion: CURRENT_SCHEMA_VERSION, projects: e.projects, folders: e.folders, tags: e.tags }, 'Invalid import');
  if (!e.targetsIncluded) {
    const issues = config.projects.flatMap((p, i) => (p.targets.length > 0 ? [`projects[${i}].targets: must be empty when targetsIncluded is false`] : []));
    if (issues.length > 0) throw new ConfigError('Invalid import', issues);
  }
  return {
    format: SHARE_FORMAT,
    schemaVersion: SHARE_SCHEMA_VERSION,
    targetsIncluded: e.targetsIncluded,
    folders: config.folders ?? [],
    tags: config.tags ?? [],
    projects: config.projects,
  };
}

const norm = (name: string): string => name.trim().toLowerCase();

export interface ProjectImportPlan {
  id: string;
  name: string;
  folderName?: string;
  tagNames: string[];
  /** The local project with the same id, if any. */
  existing?: { name: string };
  /** Distinct origins of the target addresses, in file order. */
  origins: string[];
}

export interface FolderImportPlan {
  id: string;
  name: string;
  /** A local folder with the same id or, failing that, the same name (ignoring case) exists. */
  exists: boolean;
  /** No project of the file uses it. */
  empty: boolean;
}

export interface ImportPlan {
  targetsIncluded: boolean;
  projects: ProjectImportPlan[];
  folders: FolderImportPlan[];
}

/** What the import would do, for display before the choice. Pure. */
export function planImport(current: Config, share: ShareFile): ImportPlan {
  const localFolders = current.folders ?? [];
  const folderName = new Map(share.folders.map((f) => [f.id, f.name]));
  const tagName = new Map(share.tags.map((t) => [t.id, t.name]));
  const used = new Set(share.projects.flatMap((p) => (p.folderId === undefined ? [] : [p.folderId])));
  return {
    targetsIncluded: share.targetsIncluded,
    projects: share.projects.map((p) => {
      const existing = current.projects.find((c) => c.id === p.id);
      return {
        id: p.id,
        name: p.name,
        ...(p.folderId !== undefined ? { folderName: folderName.get(p.folderId) ?? '' } : {}),
        tagNames: (p.tagIds ?? []).map((t) => tagName.get(t) ?? ''),
        ...(existing ? { existing: { name: existing.name } } : {}),
        origins: [...new Set(p.targets.map((t) => new URL(t.url).origin))],
      };
    }),
    folders: share.folders.map((f) => ({
      id: f.id,
      name: f.name,
      exists: localFolders.some((l) => l.id === f.id || norm(l.name) === norm(f.name)),
      empty: !used.has(f.id),
    })),
  };
}

export type ImportMode = 'add' | 'replace' | 'copy';

export interface ImportChoices {
  /** Chosen projects of the file. `add` needs a free local project id, `replace` an existing one; `copy` always works. */
  projects: { id: string; mode: ImportMode }[];
  /** Chosen folders of the file that no chosen project needs. */
  folderIds: string[];
  /** Appended to the name of each copy; the caller passes the translated text. */
  copySuffix: string;
}

export interface ImportResult extends StoredState {
  /** File project id -> local project id, in the order applied. */
  imported: { sourceId: string; id: string; mode: ImportMode }[];
}

const freshId = (taken: Set<string>): string => {
  let id = newId();
  while (taken.has(id)) id = newId();
  taken.add(id);
  return id;
};

/**
 * Pure part of applyImport: the new config and header values. Throws ConfigError for an invalid choice.
 * Target ids are global because header values hang on them: a colliding id is reissued, and an id of a removed
 * target is never reused, so a value can only stay with the same-id target of the same replaced project.
 */
export function computeImport(config: Config, headerValues: HeaderValues, share: ShareFile, choices: ImportChoices): { config: Config; headerValues: HeaderValues; imported: ImportResult['imported'] } {
  const next = structuredClone(config);
  const values = pruneHeaderValues(next, headerValues);
  const shareProjects = new Map(share.projects.map((p) => [p.id, p]));
  const shareFolders = new Map(share.folders.map((f) => [f.id, f]));
  const shareTags = new Map(share.tags.map((t) => [t.id, t]));
  const chosen = new Map<string, ImportMode>();
  for (const c of choices.projects) {
    if (!shareProjects.has(c.id)) throw new ConfigError('Choice refers to a project that is not in the file');
    if (chosen.has(c.id)) throw new ConfigError('A project is chosen twice');
    chosen.set(c.id, c.mode);
  }
  const chosenProjects = share.projects.filter((p) => chosen.has(p.id));
  for (const p of chosenProjects) {
    const exists = next.projects.some((c) => c.id === p.id);
    const mode = chosen.get(p.id);
    if (mode === 'add' && exists) throw new ConfigError('Cannot add a project whose id already exists; replace it or add a copy');
    if (mode === 'replace' && !exists) throw new ConfigError('Cannot replace a project that does not exist');
  }
  for (const id of choices.folderIds) if (!shareFolders.has(id)) throw new ConfigError('Choice refers to a folder that is not in the file');

  // Folders: same id, else same name, else new.
  const folders = next.folders ?? [];
  const folderIds = new Set(folders.map((f) => f.id));
  const folderMap = new Map<string, string>();
  const mapFolder = (fileId: string): string => {
    const known = folderMap.get(fileId);
    if (known !== undefined) return known;
    const f = shareFolders.get(fileId) as Folder;
    let local = folders.find((l) => l.id === f.id)?.id ?? folders.find((l) => norm(l.name) === norm(f.name))?.id;
    if (local === undefined) {
      local = folderIds.has(f.id) ? freshId(folderIds) : f.id;
      folderIds.add(local);
      folders.push({ id: local, name: f.name });
    }
    folderMap.set(fileId, local);
    return local;
  };
  // Tags: by name, else new.
  const tags = next.tags ?? [];
  const tagIds = new Set(tags.map((t) => t.id));
  const tagMap = new Map<string, string>();
  const mapTag = (fileId: string): string => {
    const known = tagMap.get(fileId);
    if (known !== undefined) return known;
    const t = shareTags.get(fileId) as Tag;
    let local = tags.find((l) => norm(l.name) === norm(t.name))?.id;
    if (local === undefined) {
      local = tagIds.has(t.id) ? freshId(tagIds) : t.id;
      tagIds.add(local);
      tags.push({ id: local, name: t.name });
    }
    tagMap.set(fileId, local);
    return local;
  };

  const projectIds = new Set(next.projects.map((p) => p.id));
  const taken = new Set(next.projects.flatMap((p) => p.targets.map((t) => t.id)));
  const imported: ImportResult['imported'] = [];
  for (const source of chosenProjects) {
    const mode = chosen.get(source.id) as ImportMode;
    const project = structuredClone(source);
    delete project.folderId;
    delete project.tagIds;
    if (source.folderId !== undefined) project.folderId = mapFolder(source.folderId);
    if (source.tagIds !== undefined) project.tagIds = source.tagIds.map(mapTag);

    const index = mode === 'replace' ? next.projects.findIndex((p) => p.id === source.id) : -1;
    const old = index >= 0 ? (next.projects[index] as Project) : undefined;
    if (mode === 'copy') {
      project.id = freshId(projectIds);
      project.name = `${source.name}${choices.copySuffix}`;
    } else if (mode === 'add') projectIds.add(project.id);

    if (old && !share.targetsIncluded) {
      project.targets = old.targets;
    } else {
      // Only a replaced project may keep an id of its own current targets (and with it the header values).
      const own = new Set(old?.targets.map((t) => t.id));
      project.targets = project.targets.map((t) => {
        const keep = mode !== 'copy' && (own.has(t.id) || !taken.has(t.id));
        own.delete(t.id);
        const id = keep ? t.id : freshId(taken);
        taken.add(id);
        return { ...t, id };
      });
    }
    if (old) next.projects[index] = project;
    else next.projects.push(project);
    imported.push({ sourceId: source.id, id: project.id, mode });
  }
  for (const id of choices.folderIds) mapFolder(id);

  if (folders.length > 0) next.folders = folders;
  if (tags.length > 0) next.tags = tags;
  return { config: next, headerValues: values, imported };
}

/**
 * Applies the chosen part of a share file on the freshly stored state in one write (`updateStored`).
 * An invalid choice or result writes nothing; header values are pruned as usual and never part of an error.
 */
export async function applyImport(share: ShareFile, choices: ImportChoices, storage?: StorageArea): Promise<ImportResult> {
  let imported: ImportResult['imported'] = [];
  const state = await updateStored((config, headerValues) => {
    const result = computeImport(config, headerValues, share, choices);
    imported = result.imported;
    return { config: result.config, headerValues: result.headerValues };
  }, storage);
  return { ...state, imported };
}
