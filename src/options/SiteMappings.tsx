import { useId } from 'react';
import type { Project } from '../config';
import { useI18n } from '../settings';
import { Button, EmptyState, IconButton, Tooltip } from '../ui/components';
import { errorsAt, type Issue } from './draft';

interface Props {
  project: Project;
  basePath: string;
  issues: Issue[];
  onDeleteEntry: (domain: string, key: string) => void;
  onDeleteDomain: (domain: string) => void;
}

export function SiteMappings({ project, basePath, issues, onDeleteEntry, onDeleteDomain }: Props) {
  const { t } = useI18n();
  const id = useId();
  const sites = Object.entries(project.siteMappings);
  const labelOf = (key: string) => project.fields.find((f) => f.key === key)?.label ?? t('options.mappings.unknownField');
  return (
    <section aria-labelledby={`${id}-title`} className="options-section">
      <h3 id={`${id}-title`}>{t('options.mappings.title')}</h3>
      <p className="q-hint">{t('options.mappings.hint')}</p>
      {sites.length === 0 && <EmptyState title={t('options.mappings.empty')} />}
      {sites.map(([site, map]) => (
        <section key={site} aria-label={t('options.mappings.site', { site })} className="options-site">
          <div className="options-site-head">
            <h4>{site}</h4>
            <Button variant="danger" icon="trash" onClick={() => onDeleteDomain(site)}>
              {t('options.mappings.deleteSite', { site })}
            </Button>
          </div>
          <ul className="options-mapping-list">
            {Object.entries(map).map(([key, selector]) => {
              const field = labelOf(key);
              const errors = errorsAt(issues, `${basePath}.siteMappings.${site}.${key}`);
              return (
                <li key={key}>
                  <span className="options-mapping-label">{field}</span>
                  <Tooltip content={selector}>
                    {(tip) => <IconButton icon="info" label={t('options.mappings.show', { field })} className="q-help" {...tip} />}
                  </Tooltip>
                  <IconButton icon="trash" label={t('options.mappings.delete', { field, site })} onClick={() => onDeleteEntry(site, key)} />
                  {errors.length > 0 && <span className="q-error">{errors.join('; ')}</span>}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </section>
  );
}
