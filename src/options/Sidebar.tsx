import { useEffect, useRef, useState } from 'react';
import type { Config, Folder, Project } from '../config';
import { useI18n } from '../settings';
import { Button, Dialog, Icon, IconButton, Menu, type IconName, type MenuEntry } from '../ui/components';
import { folderNameError, groupNeighbor } from './draft';
import { ProjectMenu } from './ProjectMenu';
import { ShareFileInput } from './ShareImportDialog';
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
  /** Creates the folder in the draft right away and returns its id. */
  onAddFolder: (name: string) => string;
  onRenameFolder: (id: string, name: string) => void;
  onMoveFolder: (index: number, delta: -1 | 1) => void;
  onDeleteFolder: (id: string) => void;
  onExportFolder: (id: string) => void;
  onMoveProject: (id: string, delta: -1 | 1) => void;
  onExportProject: (id: string) => void;
  /** Deletes exactly the project of the row, which need not be the open one. */
  onDeleteProject: (id: string) => void;
  onImportFile: (file: File) => void;
}

type FolderDialog = { id: string };

export function Brand() {
  const { t } = useI18n();
  return (
    <div className="options-brand">
      <img src="/icon/32.png" alt="" width={32} height={32} />
      <h1>{t('options.title')}</h1>
    </div>
  );
}

export function Sidebar({ projects, folders = [], config, current, dirty, onAdd, onAddFolder, onRenameFolder, onMoveFolder, onDeleteFolder, onExportFolder, onMoveProject, onExportProject, onDeleteProject, onImportFile }: Props) {
  const { t, tn } = useI18n();
  // Delete confirmation, and the folder whose name is being edited in its row.
  const [dialog, setDialog] = useState<FolderDialog>();
  const [editing, setEditing] = useState<string>();
  const restoreFocus = useRef<string>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);
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
  const dialogFolder = dialog ? folders.find((f) => f.id === dialog.id) : undefined;
  // After Enter or Escape the focus goes back to the folder row; a blur must not pull it away from where the user went.
  useEffect(() => {
    const id = restoreFocus.current;
    if (editing || !id) return;
    restoreFocus.current = undefined;
    document.querySelector<HTMLElement>(`[data-folder-toggle="${CSS.escape(id)}"]`)?.focus();
  }, [editing]);
  const addFolderInline = () => {
    let name = t('options.folders.defaultName');
    for (let n = 2; folderNameError(config, name); n++) name = `${t('options.folders.defaultName')} ${n}`;
    setEditing(onAddFolder(name));
  };
  const isCurrent = (view: NavTarget['view'], id?: string) =>
    current?.view === view && (current.view !== 'project' || current.id === id);
  const link = (href: string, on: boolean, text: string, icon?: IconName) => (
    <a href={href} className={on ? 'options-nav-link is-current' : 'options-nav-link'} aria-current={on ? 'page' : undefined}>
      {icon && <Icon name={icon} />}
      <span>{text}</span>
    </a>
  );
  const projectItem = (p: Project) => {
    const name = p.name || t('options.projects.unnamed');
    return (
      <li key={p.id} className="options-row">
        {link(projectHash(p.id), isCurrent('project', p.id), name, 'project')}
        <ProjectMenu
          name={name}
          canMoveUp={groupNeighbor(projects, folders, p.id, -1) >= 0}
          canMoveDown={groupNeighbor(projects, folders, p.id, 1) >= 0}
          onMove={(delta) => onMoveProject(p.id, delta)}
          onExport={() => onExportProject(p.id)}
          onDelete={() => onDeleteProject(p.id)}
        />
      </li>
    );
  };
  const titleEntries: MenuEntry[] = [
    { kind: 'action', icon: 'project-plus', label: t('options.projects.add'), onSelect: onAdd },
    { kind: 'action', icon: 'file-import', label: t('options.shareImport.fromFileProject'), onSelect: () => fileInput.current?.click() },
    { kind: 'separator' },
    { kind: 'action', icon: 'folder-plus', label: t('options.folders.add'), onSelect: addFolderInline },
    { kind: 'action', icon: 'file-import', label: t('options.shareImport.fromFileFolder'), onSelect: () => fileInput.current?.click() },
  ];
  const titleId = 'options-nav-projects';
  const filterId = 'options-nav-filter';
  return (
    <aside className="options-sidebar">
      <Brand />
      <p role="status" className="options-unsaved">
        {dirty && (
          <>
            <Icon name="pencil" />
            {t('options.nav.unsaved')}
          </>
        )}
      </p>
      <nav aria-label={t('options.nav.label')}>
        <div className="options-nav-group">
          <div className="options-nav-heading">
            <p id={titleId} className="options-nav-title">{t('options.projects.title')}</p>
            <Menu label={t('options.projects.menu')} entries={titleEntries} />
          </div>
          <ShareFileInput inputRef={fileInput} onFile={onImportFile} />
          {tags.length > 0 && (
            <div role="group" aria-labelledby={filterId} className="options-tag-filter">
              <div className="options-filter-line">
                <p id={filterId} className="options-nav-title">{t('options.filter.label')}</p>
                <IconButton icon="info" label={t('ui.moreInfo')} tooltip={t('options.filter.hint')} className="q-help" />
                {filtering && (
                  <span className="options-filter-active">
                    <span role="status" className="options-filter-count">{tn('options.filter.active', shown)}</span>
                    <IconButton icon="filter-clear" label={t('options.filter.reset')} onClick={() => changeFilter([])} />
                  </span>
                )}
              </div>
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
            </div>
          )}
          <ul aria-labelledby={titleId} className="options-nav-projects">
            {projects.filter((p) => (!p.folderId || !folders.some((f) => f.id === p.folderId)) && visible(p)).map(projectItem)}
            {folders.map((f, index) => {
              const inside = projects.filter((p) => p.folderId === f.id && visible(p));
              const renaming = editing === f.id;
              if (filtering && inside.length === 0 && !renaming) return null;
              const expanded = filtering ? !shut[f.id] : (open[f.id] ?? f.id === currentFolder);
              const listId = `options-folder-${f.id}`;
              const name = f.name || t('options.folders.unnamed');
              const entries: MenuEntry[] = [
                { kind: 'action', icon: 'pencil', label: t('options.folders.rename'), onSelect: () => setEditing(f.id) },
                { kind: 'action', icon: 'arrow-up', label: t('options.menu.moveUp'), disabled: index === 0, onSelect: () => onMoveFolder(index, -1) },
                { kind: 'action', icon: 'arrow-down', label: t('options.menu.moveDown'), disabled: index === folders.length - 1, onSelect: () => onMoveFolder(index, 1) },
                { kind: 'action', icon: 'file-export', label: t('options.share.export'), onSelect: () => onExportFolder(f.id) },
                { kind: 'separator' },
                { kind: 'action', icon: 'trash', danger: true, label: t('options.folders.delete'), onSelect: () => setDialog({ id: f.id }) },
              ];
              return (
                <li key={f.id} className="options-folder" data-testid="options-folder">
                  {renaming ? (
                    <FolderNameInput
                      folder={f}
                      config={config}
                      onRename={(next) => onRenameFolder(f.id, next)}
                      onDone={(restore) => {
                        if (restore) restoreFocus.current = f.id;
                        setEditing(undefined);
                      }}
                    />
                  ) : (
                    <div className="options-folder-head options-row">
                      <button
                        type="button"
                        className="options-folder-toggle"
                        data-folder-toggle={f.id}
                        aria-expanded={expanded}
                        aria-controls={listId}
                        onClick={() => (filtering ? setShut((o) => ({ ...o, [f.id]: expanded })) : setOpen((o) => ({ ...o, [f.id]: !expanded })))}
                      >
                        <Icon name={expanded ? 'folder-open' : 'folder'} />
                        <span className="options-folder-name">{name}</span>
                        <span className="options-folder-count" data-testid="options-folder-count">{inside.length}</span>
                      </button>
                      <Menu label={t('options.folders.menu', { name })} entries={entries} />
                    </div>
                  )}
                  <ul id={listId} hidden={!expanded} className="options-folder-projects">
                    {inside.length === 0 ? <li className="options-folder-empty q-hint">{t('options.folders.empty')}</li> : inside.map(projectItem)}
                  </ul>
                </li>
              );
            })}
          </ul>
        </div>
        <ul className="options-nav-areas">
          <li>{link(TAGS_HASH, isCurrent('tags'), t('options.nav.tags'))}</li>
          <li>{link(SETTINGS_HASH, isCurrent('settings'), t('options.nav.settings'))}</li>
          <li>{link(IMPORT_EXPORT_HASH, isCurrent('import-export'), t('options.nav.importExport'))}</li>
          <li>{link(HELP_HASH, isCurrent('help'), t('options.nav.help'))}</li>
        </ul>
      </nav>
      {dialogFolder && (
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

interface NameInputProps {
  folder: Folder;
  config: Config;
  onRename: (name: string) => void;
  /** `restore`: put the focus back on the folder row (Enter and Escape, not a blur). */
  onDone: (restore: boolean) => void;
}

/** The name of a folder, edited in its row. The folder already exists in the draft; only a valid name is ever written. */
function FolderNameInput({ folder, config, onRename, onDone }: NameInputProps) {
  const { t } = useI18n();
  const [name, setName] = useState(folder.name);
  // A missing name is reported only after an attempt, so clearing the field to retype is not scolded.
  const [tried, setTried] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  const errorId = `options-folder-name-error-${folder.id}`;
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const problem = folderNameError(config, name, folder.id);
  const error = problem && (tried || problem !== 'missing') ? t(`options.folders.name${problem === 'missing' ? 'Missing' : problem === 'tooLong' ? 'TooLong' : 'Taken'}`) : undefined;
  const commit = (restore: boolean) => {
    if (problem) {
      setTried(true);
      return false;
    }
    finished.current = true;
    if (name.trim() !== folder.name) onRename(name.trim());
    onDone(restore);
    return true;
  };
  return (
    <div className="options-folder-edit">
      <div className="options-folder-edit-row">
        <Icon name="folder" />
        <input
          ref={input}
          className="q-input"
          value={name}
          aria-label={t('options.folders.name')}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit(true);
            } else if (e.key === 'Escape') {
              // Escape always leaves, even with an invalid name; the stored name stays as it was.
              e.preventDefault();
              e.stopPropagation();
              finished.current = true;
              onDone(true);
            }
          }}
          onBlur={() => {
            if (finished.current) return;
            if (!commit(false)) setTimeout(() => input.current?.isConnected && input.current.focus(), 0);
          }}
        />
      </div>
      {error && (
        <p id={errorId} className="q-error">
          <Icon name="error" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
