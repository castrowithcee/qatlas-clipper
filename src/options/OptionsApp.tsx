import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ConfigError,
  StoredStateChangedError,
  loadStoredState,
  mergeConfig,
  newId,
  storedStateEquals,
  subscribeStored,
  updateStored,
  type Config,
  type FieldRenames,
  type HeaderValues,
  type MergeConflict,
  type MergeResult,
  type Project,
  type ShareFile,
  type StorageArea,
  type StoredState,
  type SubscribeStored,
} from '../config';
import { defaultPermissions, originPattern, originPatterns, type PermissionStatus, type PermissionsApi } from './permissions';
import { HelpSection } from './HelpSection';
import { ImportExport } from './ImportExport';
import { ProjectEditor } from './ProjectEditor';
import { TagsSection } from './TagsSection';
import { ShareExportDialog, type ShareRequest } from './ShareExportDialog';
import { ShareImportDialog, readShareFile } from './ShareImportDialog';
import { Brand, Sidebar, type NavTarget } from './Sidebar';
import { defaultFocusChannel, takeOptionsFocus, type FocusChannel } from './focus';
import { navigate, parseHash, projectHash, useHash } from './route';
import { addFolder, addTagToProject, deleteFolder, groupNeighbor, moveFolder, moveProjectInGroup, moveProjectTo, newProject, renameFolder, normalize, unmappedIssues, validate } from './draft';
import { SettingsSection, useI18n } from '../settings';
import { Button, Dialog, Disclosure, EmptyState, ErrorState, LoadingState, NotificationsProvider, useNotifications } from '../ui/components';
import './options.css';

type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; saved: Config; values: HeaderValues };

interface Props {
  /** Defaults to chrome.storage.local via the config module. */
  storage?: StorageArea;
  /** Defaults to browser.permissions. */
  permissions?: PermissionsApi;
  /** Popup handoff; defaults to storage.session. */
  focus?: FocusChannel;
  /** Notifies about writes of the stored configuration by any context; defaults to storage.onChanged. */
  stored?: SubscribeStored;
}

/** The notification area sits above everything that is remounted, so messages survive the reload after an import. */
export function OptionsApp(props: Props) {
  return (
    <NotificationsProvider>
      <OptionsContent {...props} />
    </NotificationsProvider>
  );
}

function OptionsContent({ storage, permissions = defaultPermissions, focus, stored = subscribeStored }: Props) {
  const { t } = useI18n();
  const [loaded, setLoaded] = useState<Load>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    document.title = t('options.title');
  }, [t]);

  // An unknown id ends in the regular "not found" view; the draft is not touched by navigating.
  useEffect(() => {
    const channel = focus ?? defaultFocusChannel();
    const take = () => void takeOptionsFocus(channel.storage).then((id) => id !== undefined && navigate(projectHash(id)), () => undefined);
    take();
    return channel.onChange(take);
  }, [focus]);

  useEffect(() => {
    let cancelled = false;
    loadStoredState(storage)
      .then((s) => !cancelled && setLoaded({ state: 'ready', saved: s.config, values: s.headerValues }))
      .catch((e: unknown) => !cancelled && setLoaded({ state: 'error', message: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, [storage, attempt]);

  const reload = () => {
    setLoaded({ state: 'loading' });
    setAttempt((n) => n + 1);
  };

  if (loaded.state === 'loading') return <Shell sidebar={<aside className="options-sidebar"><Brand /></aside>}><LoadingState /></Shell>;
  if (loaded.state === 'error') {
    // The stored config is left untouched; nothing can be saved from this state.
    return (
      <Shell sidebar={<aside className="options-sidebar"><Brand /></aside>}>
        <ErrorState title={t('options.loadError.title')} message={t('options.loadError.text')} onRetry={reload} />
        <Disclosure title={t('options.loadError.details')}>
          <pre className="options-details">{loaded.message}</pre>
        </Disclosure>
      </Shell>
    );
  }
  return <Editor key={attempt} initial={loaded.saved} initialValues={loaded.values} storage={storage} permissions={permissions} subscribe={stored} onReload={reload} />;
}

function Shell({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  return (
    <div className="options-shell">
      {sidebar}
      <main className="options-main">{children}</main>
    </div>
  );
}

// Empty per-target maps carry no value, so they must not count as changes.
const compact = (v: HeaderValues): string => JSON.stringify(Object.entries(v).filter(([, m]) => Object.keys(m).length > 0));

const targetUrls = (c: Config): string[] => c.projects.flatMap((p) => p.targets.map((t) => t.url));

interface EditorProps {
  initial: Config;
  initialValues: HeaderValues;
  storage?: StorageArea;
  permissions: PermissionsApi;
  subscribe: SubscribeStored;
  /** Reloads everything from storage, e.g. after an import replaced the configuration. */
  onReload: () => void;
}

// Limits the save-merge-save loop when other windows keep writing.
const MAX_SAVE_ATTEMPTS = 3;

interface Live {
  saved: Config;
  storedValues: HeaderValues;
  draft: Config;
  values: HeaderValues;
}

const isDirty = (l: Live): boolean => JSON.stringify(l.draft) !== JSON.stringify(l.saved) || compact(l.values) !== compact(l.storedValues);

interface PendingConflict {
  merged: MergeResult;
  theirs: StoredState;
}

function Editor({ initial, initialValues, storage, permissions, subscribe, onReload }: EditorProps) {
  const { t, tn } = useI18n();
  // `saved` and `storedValues` are the last known stored state: the base of every merge.
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const { notify, dismiss } = useNotifications();
  // The message of the last save; edits and merges make it obsolete.
  const statusId = useRef<number | undefined>(undefined);
  const setStatus = (status: { kind: 'ok' | 'error'; text: string } | undefined) => {
    if (statusId.current !== undefined) dismiss(statusId.current);
    statusId.current = status && notify(status.kind === 'ok' ? 'success' : 'error', status.text);
  };
  const [busy, setBusy] = useState(false);
  // Header values are edited apart from the config draft and stored under their own key.
  const [values, setValues] = useState(initialValues);
  const [storedValues, setStoredValues] = useState(initialValues);
  const [perm, setPerm] = useState<Record<string, PermissionStatus>>({});
  const [conflict, setConflictState] = useState<PendingConflict>();
  const [shareRequest, setShareRequest] = useState<ShareRequest>();
  const [shareImport, setShareImport] = useState<ShareFile>();
  // Mirror of the state for async handlers (storage events, save), which must not see stale closures.
  const live = useRef<Live>({ saved: initial, storedValues: initialValues, draft: initial, values: initialValues });
  const conflictRef = useRef<PendingConflict | undefined>(undefined);
  // Field key renames of the draft: project id -> key in the base -> key in the draft.
  const renames = useRef<FieldRenames>({});
  const changeSeq = useRef(0);
  const importing = useRef(false);

  const commit = (next: Partial<Live>) => {
    live.current = { ...live.current, ...next };
    if (next.saved) setSaved(next.saved);
    if (next.storedValues) setStoredValues(next.storedValues);
    if (next.draft) setDraft(next.draft);
    if (next.values) setValues(next.values);
  };
  const setConflict = (c: PendingConflict | undefined) => {
    conflictRef.current = c;
    setConflictState(c);
  };

  useEffect(() => {
    let cancelled = false;
    for (const origin of originPatterns(targetUrls(initial))) {
      permissions
        .contains([origin])
        .catch(() => false)
        .then((ok) => !cancelled && setPerm((p) => ({ ...p, [origin]: ok ? 'granted' : 'denied' })));
    }
    return () => {
      cancelled = true;
    };
  }, [initial, permissions]);

  const permissionStatus = (url: string): PermissionStatus => {
    const o = originPattern(url);
    return (o && perm[o]) || 'unchecked';
  };

  const record = (origins: string[], ok: boolean) =>
    setPerm((p) => ({ ...p, ...Object.fromEntries(origins.map((o) => [o, ok ? 'granted' : 'denied'] as const)) }));

  // Called straight from the click, with nothing awaited before, to keep the user gesture.
  const requestOne = (url: string) => {
    const origin = originPattern(url);
    if (!origin) return;
    void permissions.request([origin]).catch(() => false).then((ok) => record([origin], ok));
  };

  // Origins of targets that came from another window need their status as well.
  const checkNewOrigins = (config: Config) => {
    for (const origin of originPatterns(targetUrls(config))) {
      if (origin in perm) continue;
      void permissions.contains([origin]).catch(() => false).then((ok) => setPerm((p) => (origin in p ? p : { ...p, [origin]: ok ? 'granted' : 'denied' })));
    }
  };

  const issues = useMemo(() => validate(draft), [draft]);
  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(saved) || compact(values) !== compact(storedValues),
    [draft, saved, values, storedValues],
  );

  // Takes `theirs` as the new base. Own unsaved changes are merged in; where both sides differ, the user decides.
  const reconcile = (theirs: StoredState): 'same' | 'applied' | 'conflict' => {
    const l = live.current;
    const base: StoredState = { config: l.saved, headerValues: l.storedValues };
    if (storedStateEquals(base, theirs)) {
      setConflict(undefined);
      return 'same';
    }
    checkNewOrigins(theirs.config);
    const adopt = (result: StoredState) => {
      commit({ saved: theirs.config, storedValues: theirs.headerValues, draft: result.config, values: result.headerValues });
      if (!isDirty(live.current)) renames.current = {};
      setConflict(undefined);
      setStatus(undefined);
    };
    if (!isDirty(l)) {
      adopt(theirs);
      return 'applied';
    }
    const merged = mergeConfig({ base, mine: { config: l.draft, headerValues: l.values }, theirs, renames: renames.current });
    if (merged.conflicts.length > 0) {
      setConflict({ merged, theirs });
      return 'conflict';
    }
    adopt(merged.preferMine);
    return 'applied';
  };

  const resolve = (prefer: 'mine' | 'theirs') => {
    const c = conflictRef.current;
    if (!c) return;
    const result = prefer === 'mine' ? c.merged.preferMine : c.merged.preferTheirs;
    commit({ saved: c.theirs.config, storedValues: c.theirs.headerValues, draft: result.config, values: result.headerValues });
    if (!isDirty(live.current)) renames.current = {};
    setConflict(undefined);
    setStatus(undefined);
  };

  const refresh = async () => {
    if (importing.current) return;
    const n = ++changeSeq.current;
    let theirs: StoredState;
    try {
      theirs = await loadStoredState(storage);
    } catch {
      // An invalid stored state must not touch the draft; the next valid write is picked up.
      return;
    }
    // A later event reads a newer state; an import replaces everything and reloads the page anyway.
    if (n !== changeSeq.current || importing.current) return;
    reconcile(theirs);
  };
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => subscribe(() => void refreshRef.current()), [subscribe]);

  const route = parseHash(useHash());
  // The draft lives here, above the views, so it survives switching views and browser back.
  const byId = route.view === 'project' ? route.id : draft.projects[0]?.id;
  const selectedIndex = draft.projects.findIndex((p) => p.id === byId);
  const selected = draft.projects[selectedIndex];
  const notFound = route.view === 'project' && !selected;
  const projectView = route.view === 'project' || route.view === 'home';
  const current: NavTarget | undefined = route.view === 'tags' || route.view === 'settings' || route.view === 'import-export' || route.view === 'help' ? route : selected ? { view: 'project', id: selected.id } : undefined;

  const edit = (projects: Project[]) => {
    commit({ draft: { ...live.current.draft, projects } });
    setStatus(undefined);
  };

  // Folder edits change the whole draft configuration; they are saved with "Save" like everything else.
  const editConfig = (change: (config: Config) => Config) => {
    commit({ draft: change(live.current.draft) });
    setStatus(undefined);
  };

  const trackRename = (projectId: string, from: string, to: string) => {
    const base = live.current.saved.projects.find((p) => p.id === projectId);
    const map = { ...renames.current[projectId] };
    const origin = Object.entries(map).find(([, now]) => now === from)?.[0] ?? from;
    // Only fields of the base can be matched across versions; new fields are plain additions.
    if (!base?.fields.some((f) => f.key === origin)) return;
    if (origin === to) delete map[origin];
    else map[origin] = to;
    const { [projectId]: _old, ...rest } = renames.current;
    void _old;
    renames.current = Object.keys(map).length > 0 ? { ...rest, [projectId]: map } : rest;
  };

  const addProject = () => {
    const p = newProject(t('options.projects.newName'));
    edit([...draft.projects, p]);
    navigate(projectHash(p.id));
  };

  const moveProject = (id: string, delta: -1 | 1) => edit(moveProjectInGroup(draft.projects, draft.folders ?? [], id, delta));

  // Deletes the project with this id; the view only moves on when it was the open one.
  const deleteProject = (id: string) => {
    const at = draft.projects.findIndex((p) => p.id === id);
    if (at < 0) return;
    const next = draft.projects[at + 1] ?? draft.projects[at - 1];
    edit(draft.projects.filter((_, i) => i !== at));
    if (id === selected?.id) navigate(next ? projectHash(next.id) : '#/', true);
  };

  const discard = () => {
    commit({ draft: saved, values: storedValues });
    renames.current = {};
    setStatus(undefined);
    // A project added since the last save is gone now; do not stay on its address.
    if (route.view === 'project' && !saved.projects.some((p) => p.id === route.id)) {
      const first = saved.projects[0];
      navigate(first ? projectHash(first.id) : '#/', true);
    }
  };

  const save = async () => {
    if (conflictRef.current) return;
    // The permission request must start before the first await of this handler (user gesture).
    // It is only worth asking for if the configuration can be saved at all.
    const wanted = issues.length === 0 ? originPatterns(targetUrls(normalize(draft))).filter((o) => perm[o] !== 'granted') : [];
    const request = wanted.length > 0 ? permissions.request(wanted).catch(() => false) : undefined;
    setBusy(true);
    try {
      for (let attempt = 1; ; attempt++) {
        const l = live.current;
        const base: StoredState = { config: l.saved, headerValues: l.storedValues };
        try {
          const result = await updateStored((config, headerValues) => {
            if (!storedStateEquals({ config, headerValues }, base)) throw new StoredStateChangedError();
            return { config: normalize(l.draft), headerValues: l.values };
          }, storage);
          // Inputs made while saving stay in the draft.
          const untouched = live.current.draft === l.draft && live.current.values === l.values;
          commit(
            untouched
              ? { saved: result.config, storedValues: result.headerValues, draft: result.config, values: result.headerValues }
              : { saved: result.config, storedValues: result.headerValues },
          );
          if (untouched) renames.current = {};
          setStatus({ kind: 'ok', text: t('options.status.saved') });
          // Only revoke an origin that no remaining target in any project uses.
          const still = new Set(originPatterns(targetUrls(result.config)));
          const dropped = originPatterns(targetUrls(base.config)).filter((o) => !still.has(o));
          if (dropped.length > 0) {
            await permissions.remove(dropped).catch(() => false);
            setPerm((p) => Object.fromEntries(Object.entries(p).filter(([o]) => !dropped.includes(o))));
          }
          break;
        } catch (e) {
          if (!(e instanceof StoredStateChangedError)) throw e;
          // Another window saved first: merge its state in and save again unless the user has to decide.
          if (reconcile(await loadStoredState(storage)) === 'conflict') {
            setStatus({ kind: 'error', text: t('options.status.conflict') });
            break;
          }
          if (attempt >= MAX_SAVE_ATTEMPTS) {
            setStatus({ kind: 'error', text: t('options.status.changedAgain') });
            break;
          }
        }
      }
    } catch (e) {
      // The draft stays as it is, so no input is lost.
      if (e instanceof ConfigError) {
        setStatus({ kind: 'error', text: tn('options.status.invalid', Math.max(1, issues.length)) });
        // Move to the first marked input; the render with the message has to be done first.
        // A marked field row opens its details instead, which then focus their first marked input.
        setTimeout(() => {
          const first = document.querySelector<HTMLElement>('[aria-invalid="true"], [data-error-open], [data-error-focus]');
          if (first?.hasAttribute('data-error-open')) first.click();
          else first?.focus();
        }, 0);
      } else {
        setStatus({ kind: 'error', text: t('options.status.failed', { message: e instanceof Error ? e.message : String(e) }) });
      }
    } finally {
      setBusy(false);
    }
    if (request) {
      const ok = await request;
      if (ok) record(wanted, true);
      else {
        // One prompt covers all origins; ask which of them were granted anyway.
        for (const o of wanted) record([o], await permissions.contains([o]).catch(() => false));
      }
    }
  };

  // The import wrote the fresh stored state; the editor takes it like a change from another window, so unsaved edits stay.
  const importedShare = (state: StoredState, firstId: string | undefined) => {
    reconcile(state);
    if (firstId) navigate(projectHash(firstId));
  };
  const openShareFile = async (file: File) => setShareImport(await readShareFile(file, t));
  const openShareFileFromSidebar = (file: File) => openShareFile(file).catch((e: unknown) => notify('error', e instanceof Error ? e.message : String(e)));

  // Tag names are shown in the tag list itself, so the summary does not repeat them there.
  const summary = unmappedIssues(issues, route.view === 'tags' ? -1 : selectedIndex).filter((i) => route.view !== 'tags' || !/^tags\[\d+\]\.name$/.test(i.path));
  const projectName = (i: number) => draft.projects[i]?.name || t('options.projects.fallbackName', { n: i + 1 });

  return (
    <Shell sidebar={(
      <Sidebar
        projects={draft.projects}
        folders={draft.folders}
        config={draft}
        current={current}
        dirty={dirty}
        onAdd={addProject}
        onAddFolder={(name) => {
          const id = newId();
          editConfig((c) => addFolder(c, name, id));
          return id;
        }}
        onRenameFolder={(id, name) => editConfig((c) => renameFolder(c, id, name))}
        onMoveFolderTo={(from, to) => editConfig((c) => moveFolder(c, from, to))}
        onDeleteFolder={(id) => editConfig((c) => deleteFolder(c, id))}
        onExportFolder={(id) => setShareRequest({ projectIds: [], folderIds: [id] })}
        onMoveProjectTo={(id, folderId, index) => edit(moveProjectTo(live.current.draft.projects, live.current.draft.folders ?? [], id, folderId, index))}
        onExportProject={(id) => setShareRequest({ projectIds: [id], folderIds: [] })}
        onDeleteProject={deleteProject}
        onImportFile={openShareFileFromSidebar}
      />
    )}>
      {(projectView || route.view === 'tags') && summary.length > 0 && (
        <div role="alert" className="options-problems">
          <p>{t('options.problems.title')}</p>
          <ul>
            {summary.map((i, n) => {
              const m = /^projects\[(\d+)\]\.(.*)$/.exec(i.path);
              return <li key={n}>{m ? `${projectName(Number(m[1]))}: ${m[2]}` : i.path}: {i.message}</li>;
            })}
          </ul>
        </div>
      )}
      {projectView && (
        <>
          {notFound ? (
            <EmptyState
              title={t('options.notFound.title')}
              description={t('options.notFound.text')}
              action={
                <div className="options-state-actions">
                  {draft.projects[0] && <a className="q-button q-button--secondary" href={projectHash(draft.projects[0].id)}>{t('options.notFound.first')}</a>}
                  <Button variant="primary" icon="plus" onClick={addProject}>{t('options.projects.add')}</Button>
                </div>
              }
            />
          ) : !selected ? (
            <EmptyState
              title={t('options.empty.title')}
              description={t('options.empty.text')}
              action={<Button variant="primary" icon="plus" onClick={addProject}>{t('options.projects.add')}</Button>}
            />
          ) : (
            <ProjectEditor
              key={selected.id}
              project={selected}
              index={selectedIndex}
              canMoveUp={groupNeighbor(draft.projects, draft.folders ?? [], selected.id, -1) >= 0}
              canMoveDown={groupNeighbor(draft.projects, draft.folders ?? [], selected.id, 1) >= 0}
              folders={draft.folders ?? []}
              tags={draft.tags ?? []}
              onCreateTag={(name) => editConfig((c) => addTagToProject(c, selected.id, name))}
              onMove={(d) => moveProject(selected.id, d)}
              onDelete={() => deleteProject(selected.id)}
              onExport={() => setShareRequest({ projectIds: [selected.id], folderIds: [] })}
              issues={issues}
              headerValues={values}
              onHeaderValues={(v) => { commit({ values: v }); setStatus(undefined); }}
              onFieldRenamed={trackRename}
              permissionStatus={permissionStatus}
              onRequestPermission={requestOne}
              onChange={(p) => edit(draft.projects.map((x, i) => (i === selectedIndex ? p : x)))}
            />
          )}
        </>
      )}
      {route.view === 'tags' && <TagsSection config={draft} issues={issues} onEdit={editConfig} />}
      {route.view === 'settings' && <SettingsSection />}
      {route.view === 'help' && <HelpSection />}
      {route.view === 'import-export' && <ImportExport storage={storage} permissions={permissions} dirty={dirty} onImported={onReload} onImporting={(active) => { importing.current = active; }} onShareFile={openShareFile} />}
      <ShareExportDialog request={shareRequest} storage={storage} dirty={dirty} onClose={() => setShareRequest(undefined)} />
      <ShareImportDialog share={shareImport} storage={storage} dirty={dirty} onClose={() => setShareImport(undefined)} onImported={importedShare} />
      <ConflictDialog conflict={conflict} onResolve={resolve} />
      {dirty && (
        <div className="options-bar-dock">
          <div className="options-bar">
            <p role="status" className="options-bar-state">
              <span className="options-bar-dot" aria-hidden="true" />
              {t('options.status.dirty')}
            </p>
            <Button onClick={discard} disabled={busy || conflict !== undefined}>
              {t('options.discard')}
            </Button>
            <Button variant="primary" onClick={save} disabled={busy || conflict !== undefined} aria-busy={busy || undefined}>
              {busy && <span className="q-spinner options-bar-spinner" aria-hidden="true" />}
              {t('options.save')}
            </Button>
          </div>
        </div>
      )}
    </Shell>
  );
}

function ConflictDialog({ conflict, onResolve }: { conflict: PendingConflict | undefined; onResolve: (prefer: 'mine' | 'theirs') => void }) {
  const { t } = useI18n();
  const describe = (c: MergeConflict): string => {
    const project = c.projectName || t('options.projects.unnamed');
    const field = c.fieldLabel || c.fieldKey || t('options.fields.unnamed');
    const target = c.targetName || t('options.targets.unnamed');
    return t(`options.conflict.${c.kind}`, { project, field, domain: c.domain ?? '', target, name: c.headerName ?? '', folder: c.folderName ?? '', tag: c.tagName ?? '' });
  };
  return (
    <Dialog
      open={conflict !== undefined}
      dismissible={false}
      onClose={() => undefined}
      title={t('options.conflict.title')}
      actions={
        <>
          <Button onClick={() => onResolve('mine')}>{t('options.conflict.keepMine')}</Button>
          <Button variant="primary" onClick={() => onResolve('theirs')}>{t('options.conflict.takeTheirs')}</Button>
        </>
      }
    >
      <p>{t('options.conflict.text')}</p>
      <ul>
        {(conflict?.merged.conflicts ?? []).map((c, i) => (
          <li key={i}>{describe(c)}</li>
        ))}
      </ul>
    </Dialog>
  );
}
