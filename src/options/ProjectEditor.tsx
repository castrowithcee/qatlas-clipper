import type { Project } from '../config';
import { FieldEditor } from './FieldEditor';
import { SiteMappings } from './SiteMappings';
import { ScopeEditor } from './ScopeEditor';
import { deleteDomain, deleteField, deleteMapping, errorsAt, renameFieldKey, type Issue } from './draft';
import { TextInput } from './fields';

interface Props {
  project: Project;
  index: number;
  issues: Issue[];
  onChange: (project: Project) => void;
}

export function ProjectEditor({ project, index, issues, onChange }: Props) {
  const base = `projects[${index}]`;
  return (
    <div>
      <h2>Project: {project.name}</h2>
      <TextInput label="Project name" value={project.name} errors={errorsAt(issues, `${base}.name`)} onChange={(name) => onChange({ ...project, name })} />
      <ScopeEditor scope={project.scope} basePath={base} issues={issues} onChange={(scope) => onChange({ ...project, scope })} />
      <FieldEditor
        fields={project.fields}
        basePath={base}
        issues={issues}
        onChange={(fields) => onChange({ ...project, fields })}
        onRenameKey={(i, key) => onChange(renameFieldKey(project, i, key))}
        onDelete={(i) => onChange(deleteField(project, i))}
      />
      <SiteMappings
        project={project}
        basePath={base}
        issues={issues}
        onDeleteEntry={(d, k) => onChange(deleteMapping(project, d, k))}
        onDeleteDomain={(d) => onChange(deleteDomain(project, d))}
      />
    </div>
  );
}
