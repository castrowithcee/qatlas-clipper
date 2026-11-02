import { useState } from 'react';
import { contentFormatOf, type ContentFormat, type HeaderValues, type Project } from '../config';
import { FieldEditor } from './FieldEditor';
import { ScopeEditor } from './ScopeEditor';
import { deleteField, deleteMapping, errorsAt, renameFieldKey, type Issue } from './draft';
import { useI18n } from '../settings';
import { Button, Dialog, IconButton, Select, TextField, Tooltip } from '../ui/components';
import { TargetEditor } from './TargetEditor';
import type { PermissionStatus } from './permissions';

interface Props {
  project: Project;
  index: number;
  count: number;
  onMove: (delta: -1 | 1) => void;
  onDelete: () => void;
  issues: Issue[];
  onChange: (project: Project) => void;
  headerValues: HeaderValues;
  onHeaderValues: (values: HeaderValues) => void;
  permissionStatus: (url: string) => PermissionStatus;
  onRequestPermission: (url: string) => void;
  /** A field key was changed and its site mappings followed; lets the editor track renames for merging. */
  onFieldRenamed?: (projectId: string, from: string, to: string) => void;
}

export function ProjectEditor({ project, index, count, onMove, onDelete, issues, onChange, headerValues, onHeaderValues, permissionStatus, onRequestPermission, onFieldRenamed }: Props) {
  const { t } = useI18n();
  const base = `projects[${index}]`;
  const nameError = project.name.trim() === '' ? t('options.project.nameMissing') : errorsAt(issues, `${base}.name`)[0];
  return (
    <div className="options-project-view">
      <ProjectHeader name={project.name || t('options.projects.unnamed')} index={index} count={count} onMove={onMove} onDelete={onDelete} />
      <TextField label={t('options.project.name')} value={project.name} error={nameError} onChange={(e) => onChange({ ...project, name: e.target.value })} />
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
  index: number;
  count: number;
  onMove: (delta: -1 | 1) => void;
  onDelete: () => void;
}

function ProjectHeader({ name, index, count, onMove, onDelete }: HeaderProps) {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const order = t('options.projects.order');
  return (
    <header className="options-view-head">
      <h2>{name}</h2>
      <div className="options-view-actions">
        <Tooltip content={order}>
          {(tip) => <IconButton icon="arrow-up" label={t('options.projects.moveUp', { name })} disabled={index === 0} onClick={() => onMove(-1)} {...tip} />}
        </Tooltip>
        <Tooltip content={order}>
          {(tip) => (
            <IconButton icon="arrow-down" label={t('options.projects.moveDown', { name })} disabled={index === count - 1} onClick={() => onMove(1)} {...tip} />
          )}
        </Tooltip>
        <Button icon="trash" onClick={() => setConfirming(true)}>
          {t('options.projects.deleteConfirm')}
        </Button>
      </div>
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('options.projects.deleteTitle')}
        actions={
          <>
            <Button onClick={() => setConfirming(false)}>{t('options.cancel')}</Button>
            <Button variant="danger" icon="trash" onClick={() => { setConfirming(false); onDelete(); }}>
              {t('options.projects.deleteConfirm')}
            </Button>
          </>
        }
      >
        <p>{t('options.projects.deleteText', { name })}</p>
      </Dialog>
    </header>
  );
}
