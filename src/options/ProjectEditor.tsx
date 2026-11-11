import { contentFormatOf, type ContentFormat, type Folder, type HeaderValues, type Project, type Tag } from '../config';
import { FieldEditor } from './FieldEditor';
import { ScopeEditor } from './ScopeEditor';
import { deleteField, deleteMapping, errorsAt, renameFieldKey, setProjectFolder, setProjectTags, type Issue } from './draft';
import { useI18n } from '../settings';
import { Select, TextField } from '../ui/components';
import { ProjectMenu } from './ProjectMenu';
import { TagInput } from './TagInput';
import { TargetEditor } from './TargetEditor';
import type { PermissionStatus } from './permissions';

interface Props {
  project: Project;
  index: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  folders?: Folder[];
  /** The central tag list of the draft. */
  tags?: Tag[];
  /** Creates a tag with this name in the draft and assigns it to this project. */
  onCreateTag?: (name: string) => void;
  onMove: (delta: -1 | 1) => void;
  onDelete: () => void;
  onExport: () => void;
  issues: Issue[];
  onChange: (project: Project) => void;
  headerValues: HeaderValues;
  onHeaderValues: (values: HeaderValues) => void;
  permissionStatus: (url: string) => PermissionStatus;
  onRequestPermission: (url: string) => void;
  /** A field key was changed and its site mappings followed; lets the editor track renames for merging. */
  onFieldRenamed?: (projectId: string, from: string, to: string) => void;
}

export function ProjectEditor({ project, index, canMoveUp, canMoveDown, folders = [], tags = [], onCreateTag, onMove, onDelete, onExport, issues, onChange, headerValues, onHeaderValues, permissionStatus, onRequestPermission, onFieldRenamed }: Props) {
  const { t } = useI18n();
  const base = `projects[${index}]`;
  const nameError = project.name.trim() === '' ? t('options.project.nameMissing') : errorsAt(issues, `${base}.name`)[0];
  return (
    <div className="options-project-view">
      <ProjectHeader name={project.name || t('options.projects.unnamed')} canMoveUp={canMoveUp} canMoveDown={canMoveDown} onMove={onMove} onDelete={onDelete} onExport={onExport} />
      <TextField label={t('options.project.name')} value={project.name} error={nameError} onChange={(e) => onChange({ ...project, name: e.target.value })} />
      <Select
        label={t('options.project.folder.label')}
        help={t('options.project.folder.help')}
        value={project.folderId ?? ''}
        error={errorsAt(issues, `${base}.folderId`)[0]}
        options={[{ value: '', label: t('options.project.folder.none') }, ...folders.map((f) => ({ value: f.id, label: f.name }))]}
        onChange={(e) => onChange(setProjectFolder(project, e.target.value || undefined))}
      />
      <TagInput
        tags={tags}
        assignedIds={project.tagIds ?? []}
        error={issues.find((i) => i.path === `${base}.tagIds` || i.path.startsWith(`${base}.tagIds[`))?.message}
        onAssign={(id) => onChange(setProjectTags(project, [...(project.tagIds ?? []), id]))}
        onRemove={(id) => onChange(setProjectTags(project, (project.tagIds ?? []).filter((x) => x !== id)))}
        onCreate={(name) => onCreateTag?.(name)}
      />
      <ScopeEditor scope={project.scope} basePath={base} issues={issues} onChange={(scope) => onChange({ ...project, scope })} />
      <FieldEditor
        fields={project.fields}
        siteMappings={project.siteMappings}
        basePath={base}
        issues={issues}
        onChange={(fields) => onChange({ ...project, fields })}
        onRenameKey={(i, key) => {
          const old = project.fields[i]?.key;
          // Mappings only follow a rename onto a free key (see renameFieldKey).
          if (old !== undefined && old !== key && !project.fields.some((f, j) => j !== i && f.key === key)) onFieldRenamed?.(project.id, old, key);
          onChange(renameFieldKey(project, i, key));
        }}
        onDelete={(i) => onChange(deleteField(project, i))}
        onDeleteMapping={(site, key) => onChange(deleteMapping(project, site, key))}
      />
      <section className="options-section">
        <Select
          label={t('options.project.content.label')}
          help={t('options.project.content.help')}
          value={contentFormatOf(project)}
          options={[
            { value: 'none', label: t('options.project.content.none') },
            { value: 'markdown', label: t('options.project.content.markdown') },
            { value: 'html', label: t('options.project.content.html') },
          ]}
          onChange={(e) => onChange({ ...project, content: e.target.value as ContentFormat })}
        />
      </section>
      <TargetEditor
        targets={project.targets}
        basePath={base}
        issues={issues}
        values={headerValues}
        onValues={onHeaderValues}
        status={permissionStatus}
        onRequest={onRequestPermission}
        onChange={(targets) => onChange({ ...project, targets })}
      />
    </div>
  );
}

interface HeaderProps {
  name: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (delta: -1 | 1) => void;
  onDelete: () => void;
  onExport: () => void;
}

function ProjectHeader({ name, ...menu }: HeaderProps) {
  return (
    <header className="options-view-head">
      <h2>{name}</h2>
      <ProjectMenu name={name} {...menu} />
    </header>
  );
}
