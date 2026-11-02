import { ConfigError, updateStored, type Config, type Field, type Project, type StorageArea } from '../config';
import { newField } from '../options/draft';

/**
 * Change one project of the stored configuration through the shared merge-safe write path: `change` runs on the
 * freshly stored project, so concurrent changes elsewhere are kept. Throws ConfigError for an unknown project.
 */
export async function updateProject(
  storage: StorageArea | undefined,
  projectId: string,
  change: (project: Project) => Project,
): Promise<Config> {
  const { config } = await updateStored((config) => {
    if (!config.projects.some((p) => p.id === projectId)) throw new ConfigError(`Unknown project "${projectId}"`);
    return { config: { ...config, projects: config.projects.map((p) => (p.id === projectId ? change(p) : p)) } };
  }, storage);
  return config;
}

/** Change one field of a project (key stays as given); throws ConfigError for an unknown field. */
export function updateProjectField(
  storage: StorageArea | undefined,
  projectId: string,
  fieldKey: string,
  change: (field: Field) => Field,
): Promise<Config> {
  return updateProject(storage, projectId, (project) => {
    if (!project.fields.some((f) => f.key === fieldKey)) throw new ConfigError(`Unknown field "${fieldKey}"`);
    return { ...project, fields: project.fields.map((f) => (f.key === fieldKey ? change(f) : f)) };
  });
}

/** Append a field (way "per click") to the project; the key is derived against the freshly stored fields. */
export async function addCapturedField(
  storage: StorageArea | undefined,
  projectId: string,
  label: string,
): Promise<{ config: Config; field: Field }> {
  if (label.trim() === '') throw new ConfigError('Field label is empty');
  let field: Field | undefined;
  const config = await updateProject(storage, projectId, (project) => {
    field = newField(project.fields, label);
    return { ...project, fields: [...project.fields, field] };
  });
  return { config, field: field! };
}
