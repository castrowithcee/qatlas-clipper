import { useState, type FormEvent } from 'react';
import type { Config, Folder, Project } from '../config';
import { useI18n } from '../settings';
import { Button, Dialog, Icon, Menu, TextField, type MenuEntry } from '../ui/components';
import { folderNameError } from './draft';
import { HELP_HASH, IMPORT_EXPORT_HASH, projectHash, SETTINGS_HASH, TAGS_HASH } from './route';

export type NavTarget = { view: 'project'; id: string } | { view: 'tags' } | { view: 'settings' } | { view: 'import-export' } | { view: 'help' };

interface Props {
  projects: Project[];
  folders?: Folder[];
  /** The whole draft; read to check folder names and for the tag list of the filter. */
  config: Config;
  current: NavTarget | undefined;
  dirty: boolean;
  onAdd: () => void;
  onAddFolder: (name: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onMoveFolder: (index: number, delta: -1 | 1) => void;
  onDeleteFolder: (id: string) => void;
  onExportFolder: (id: string) => void;
}

type FolderDialog = { kind: 'add' } | { kind: 'rename'; id: string } | { kind: 'delete'; id: string };

export function Brand() {
  const { t } = useI18n();
  return (
    <div className="options-brand">
      <img src="/icon/32.png" alt="" width={32} height={32} />
      <h1>{t('options.title')}</h1>
    </div>
  );
}

export function Sidebar({ projects, folders = [], config, current, dirty, onAdd, onAddFolder, onRenameFolder, onMoveFolder, onDeleteFolder, onExportFolder }: Props) {
  const { t, tn } = useI18n();
  const [dialog, setDialog] = useState<FolderDialog>();
  // The tag filter is view state of this page only; it is never stored (not in the configuration, not in storage).
  const [chosen, setChosen] = useState<string[]>([]);
  // Folders closed by hand while a filter is on; reset whenever the filter changes.
  const [shut, setShut] = useState<Record<string, boolean>>({});
  const tags = config.tags ?? [];
  const active = chosen.filter((id) => tags.some((x) => x.id === id));
  const filtering = active.length > 0;
  const visible = (p: Project) => !filtering || (p.tagIds ?? []).some((id) => active.includes(id));
  const changeFilter = (next: string[]) => {
    setChosen(next);
    setShut({});
  };
  const shown = projects.filter(visible).length;
  // Expansion is view state only; it is never part of the configuration.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const currentId = current?.view === 'project' ? current.id : undefined;
  const currentFolder = projects.find((p) => p.id === currentId)?.folderId;
  // Opening another project reveals it again even if its folder was closed by hand (adjusted during render, not in an effect).
  const [seenId, setSeenId] = useState(currentId);
  if (seenId !== currentId) {
    setSeenId(currentId);
    if (currentFolder) setOpen((o) => Object.fromEntries(Object.entries(o).filter(([id]) => id !== currentFolder)));
  }
  const dialogFolder = dialog && dialog.kind !== 'add' ? folders.find((f) => f.id === dialog.id) : undefined;
  const isCurrent = (view: NavTarget['view'], id?: string) =>
    current?.view === view && (current.view !== 'project' || current.id === id);
  const link = (href: string, on: boolean, text: string) => (
    <a href={href} className={on ? 'options-nav-link is-current' : 'options-nav-link'} aria-current={on ? 'page' : undefined}>
      {text}
    </a>
  );
  const projectItem = (p: Project) => (
    <li key={p.id}>{link(projectHash(p.id), isCurrent('project', p.id), p.name || t('options.projects.unnamed'))}</li>
  );
  const titleId = 'options-nav-projects';
  const filterId = 'options-nav-filter';
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
          {tags.length > 0 && (
            <div role="group" aria-labelledby={filterId} className="options-tag-filter">
              <p id={filterId} className="options-nav-title">{t('options.filter.label')}</p>
              <ul className="options-tag-filter-list">
                {tags.map((x) => {
                  const on = active.includes(x.id);
                  return (
                    <li key={x.id}>
                      <button
                        type="button"
                        className="options-tag-toggle"
                        aria-pressed={on}
                        onClick={() => changeFilter(on ? active.filter((id) => id !== x.id) : [...active, x.id])}
                      >
                        {x.name}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="q-hint options-filter-hint">{t('options.filter.hint')}</p>
              {filtering && (
                <div className="options-filter-active" role="status">
                  <span>{tn('options.filter.active', shown)}</span>
                  <Button onClick={() => changeFilter([])}>{t('options.filter.reset')}</Button>
                </div>
              )}
            </div>
          )}
          <ul aria-labelledby={titleId} className="options-nav-projects">
            {projects.filter((p) => (!p.folderId || !folders.some((f) => f.id === p.folderId)) && visible(p)).map(projectItem)}
            {folders.map((f, index) => {
              const inside = projects.filter((p) => p.folderId === f.id && visible(p));
              if (filtering && inside.length === 0) return null;
              const expanded = filtering ? !shut[f.id] : (open[f.id] ?? f.id === currentFolder);
              const listId = `options-folder-${f.id}`;
              const name = f.name || t('options.folders.unnamed');
              const entries: MenuEntry[] = [
                { kind: 'action', label: t('options.folders.rename'), onSelect: () => setDialog({ kind: 'rename', id: f.id }) },
                ...(index > 0 ? [{ kind: 'action' as const, label: t('options.folders.moveUp'), onSelect: () => onMoveFolder(index, -1) }] : []),
                ...(index < folders.length - 1 ? [{ kind: 'action' as const, label: t('options.folders.moveDown'), onSelect: () => onMoveFolder(index, 1) }] : []),
                { kind: 'action', label: t('options.share.export'), onSelect: () => onExportFolder(f.id) },
                { kind: 'action', label: t('options.folders.delete'), onSelect: () => setDialog({ kind: 'delete', id: f.id }) },
              ];
              return (
                <li key={f.id} className="options-folder" data-testid="options-folder">
                  <div className="options-folder-head">
                    <button
                      type="button"
                      className="options-folder-toggle"
                      aria-expanded={expanded}
                      aria-controls={listId}
                      onClick={() => (filtering ? setShut((o) => ({ ...o, [f.id]: expanded })) : setOpen((o) => ({ ...o, [f.id]: !expanded })))}
                    >
                      <Icon name={expanded ? 'chevron-down' : 'chevron-right'} />
                      <span className="options-folder-name">{name}</span>
                      <span className="options-folder-count" data-testid="options-folder-count">{inside.length}</span>
                    </button>
                    <Menu label={t('options.folders.menu', { name })} entries={entries} />
                  </div>
                  <ul id={listId} hidden={!expanded} className="options-folder-projects">
                    {inside.length === 0 ? <li className="options-folder-empty q-hint">{t('options.folders.empty')}</li> : inside.map(projectItem)}
                  </ul>
                </li>
              );
            })}
          </ul>
        </div>
        <Button icon="plus" className="options-nav-add" onClick={onAdd}>
          {t('options.projects.add')}
        </Button>
        <Button icon="plus" className="options-nav-add" onClick={() => setDialog({ kind: 'add' })}>
          {t('options.folders.add')}
        </Button>
        <ul className="options-nav-areas">
          <li>{link(TAGS_HASH, isCurrent('tags'), t('options.nav.tags'))}</li>
          <li>{link(SETTINGS_HASH, isCurrent('settings'), t('options.nav.settings'))}</li>
          <li>{link(IMPORT_EXPORT_HASH, isCurrent('import-export'), t('options.nav.importExport'))}</li>
          <li>{link(HELP_HASH, isCurrent('help'), t('options.nav.help'))}</li>
        </ul>
      </nav>
      {dialog?.kind === 'add' && (
        <FolderNameDialog
          title={t('options.folders.addTitle')}
          submit={t('options.folders.create')}
          initial=""
          config={config}
          onClose={() => setDialog(undefined)}
          onSubmit={onAddFolder}
        />
      )}
      {dialog?.kind === 'rename' && dialogFolder && (
        <FolderNameDialog
          title={t('options.folders.renameTitle')}
          submit={t('options.folders.rename')}
          initial={dialogFolder.name}
          exceptId={dialogFolder.id}
          config={config}
          onClose={() => setDialog(undefined)}
          onSubmit={(name) => onRenameFolder(dialogFolder.id, name)}
        />
      )}
      {dialog?.kind === 'delete' && dialogFolder && (
        <Dialog
          open
          onClose={() => setDialog(undefined)}
          title={t('options.folders.deleteTitle')}
          actions={
            <>
              <Button onClick={() => setDialog(undefined)}>{t('options.cancel')}</Button>
              <Button variant="danger" icon="trash" onClick={() => { setDialog(undefined); onDeleteFolder(dialogFolder.id); }}>
                {t('options.folders.delete')}
              </Button>
            </>
          }
        >
          <p>{t('options.folders.deleteText', { name: dialogFolder.name })}</p>
        </Dialog>
      )}
    </aside>
  );
}

interface NameDialogProps {
  title: string;
  submit: string;
  initial: string;
  exceptId?: string;
  config: Config;
  onClose: () => void;
  onSubmit: (name: string) => void;
}

function FolderNameDialog({ title, submit, initial, exceptId, config, onClose, onSubmit }: NameDialogProps) {
  const { t } = useI18n();
  const [name, setName] = useState(initial);
  // A missing name is reported only after an attempt, so the empty field is not scolded on opening.
  const [tried, setTried] = useState(false);
  const problem = folderNameError(config, name, exceptId);
  const error = problem && (tried || problem !== 'missing') ? t(`options.folders.name${problem === 'missing' ? 'Missing' : problem === 'tooLong' ? 'TooLong' : 'Taken'}`) : undefined;
  const send = (e?: FormEvent) => {
    e?.preventDefault();
    if (problem) return setTried(true);
    onSubmit(name.trim());
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      actions={
        <>
          <Button onClick={onClose}>{t('options.cancel')}</Button>
          <Button variant="primary" onClick={send}>{submit}</Button>
        </>
      }
    >
      <form onSubmit={send} noValidate>
        <TextField
          data-autofocus
          label={t('options.folders.name')}
          hint={t('options.folders.nameHint')}
          value={name}
          error={error}
          onChange={(e) => setName(e.target.value)}
        />
      </form>
    </Dialog>
  );
}
