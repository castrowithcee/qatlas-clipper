import type { Project } from '../config';
import { useI18n } from '../settings';
import { Button, Icon } from '../ui/components';
import { IMPORT_EXPORT_HASH, projectHash, SETTINGS_HASH } from './route';

export type NavTarget = { view: 'project'; id: string } | { view: 'settings' } | { view: 'import-export' };

interface Props {
  projects: Project[];
  current: NavTarget | undefined;
  dirty: boolean;
  onAdd: () => void;
}

export function Brand() {
  const { t } = useI18n();
  return (
    <div className="options-brand">
      <img src="/icon/32.png" alt="" width={32} height={32} />
      <h1>{t('options.title')}</h1>
    </div>
  );
}

export function Sidebar({ projects, current, dirty, onAdd }: Props) {
  const { t } = useI18n();
  const isCurrent = (view: NavTarget['view'], id?: string) =>
    current?.view === view && (current.view !== 'project' || current.id === id);
  const link = (href: string, on: boolean, text: string) => (
    <a href={href} className={on ? 'options-nav-link is-current' : 'options-nav-link'} aria-current={on ? 'page' : undefined}>
      {text}
    </a>
  );
  const titleId = 'options-nav-projects';
  return (
    <aside className="options-sidebar">
      <Brand />
      <p role="status" className="options-unsaved">
        {dirty && (
          <>
            <Icon name="edit" />
            {t('options.nav.unsaved')}
          </>
        )}
      </p>
      <nav aria-label={t('options.nav.label')}>
        <div className="options-nav-group">
          <p id={titleId} className="options-nav-title">{t('options.projects.title')}</p>
          <ul aria-labelledby={titleId} className="options-nav-projects">
          {projects.map((p) => (
            <li key={p.id}>{link(projectHash(p.id), isCurrent('project', p.id), p.name || t('options.projects.unnamed'))}</li>
          ))}
          </ul>
        </div>
        <Button icon="plus" className="options-nav-add" onClick={onAdd}>
          {t('options.projects.add')}
        </Button>
        <ul className="options-nav-areas">
          <li>{link(SETTINGS_HASH, isCurrent('settings'), t('options.nav.settings'))}</li>
          <li>{link(IMPORT_EXPORT_HASH, isCurrent('import-export'), t('options.nav.importExport'))}</li>
        </ul>
      </nav>
    </aside>
  );
}
