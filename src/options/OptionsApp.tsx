import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ConfigError,
  loadConfig,
  loadHeaderValues,
  pruneHeaderValues,
  saveConfig,
  setHeaderValue,
  type Config,
  type HeaderValues,
  type Project,
  type StorageArea,
} from '../config';
import { defaultPermissions, originPattern, originPatterns, type PermissionStatus, type PermissionsApi } from './permissions';
import { ImportExport } from './ImportExport';
import { ProjectEditor } from './ProjectEditor';
import { Brand, Sidebar, type NavTarget } from './Sidebar';
import { defaultFocusChannel, takeOptionsFocus, type FocusChannel } from './focus';
import { navigate, parseHash, projectHash, useHash } from './route';
import { moveItem, newProject, normalize, unmappedIssues, validate } from './draft';
import { SettingsSection, useI18n } from '../settings';
import { Button, Disclosure, EmptyState, ErrorState, LoadingState, Toast } from '../ui/components';
import './options.css';

type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; saved: Config; values: HeaderValues };

interface Props {
  /** Defaults to chrome.storage.local via the config module. */
  storage?: StorageArea;
  /** Defaults to browser.permissions. */
  permissions?: PermissionsApi;
  /** Popup handoff; defaults to storage.session. */
  focus?: FocusChannel;
}

export function OptionsApp({ storage, permissions = defaultPermissions, focus }: Props) {
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
    Promise.all([loadConfig(storage), loadHeaderValues(storage)])
      .then(([saved, values]) => !cancelled && setLoaded({ state: 'ready', saved, values }))
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
  return <Editor key={attempt} initial={loaded.saved} initialValues={loaded.values} storage={storage} permissions={permissions} onReload={reload} />;
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
  /** Reloads everything from storage, e.g. after an import replaced the configuration. */
  onReload: () => void;
}

function Editor({ initial, initialValues, storage, permissions, onReload }: EditorProps) {
  const { t, tn } = useI18n();
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string }>();
  const [busy, setBusy] = useState(false);
  // Header values are edited apart from the config draft and stored under their own key.
  const [values, setValues] = useState(initialValues);
  const [storedValues, setStoredValues] = useState(initialValues);
  const [perm, setPerm] = useState<Record<string, PermissionStatus>>({});

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

  const issues = useMemo(() => validate(draft), [draft]);
  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(saved) || compact(values) !== compact(storedValues),
    [draft, saved, values, storedValues],
  );
  const route = parseHash(useHash());
  // The draft lives here, above the views, so it survives switching views and browser back.
  const byId = route.view === 'project' ? route.id : draft.projects[0]?.id;
  const selectedIndex = draft.projects.findIndex((p) => p.id === byId);
  const selected = draft.projects[selectedIndex];
  const notFound = route.view === 'project' && !selected;
  const projectView = route.view === 'project' || route.view === 'home';
  const current: NavTarget | undefined = route.view === 'settings' || route.view === 'import-export' ? route : selected ? { view: 'project', id: selected.id } : undefined;

  const edit = (projects: Project[]) => {
    setDraft({ ...draft, projects });
    setStatus(undefined);
  };

  const addProject = () => {
    const p = newProject(t('options.projects.newName'));
    edit([...draft.projects, p]);
    navigate(projectHash(p.id));
  };

  const deleteSelected = () => {
    const next = draft.projects[selectedIndex + 1] ?? draft.projects[selectedIndex - 1];
    edit(draft.projects.filter((_, i) => i !== selectedIndex));
    navigate(next ? projectHash(next.id) : '#/', true);
  };

  const discard = () => {
    setDraft(saved);
    setValues(storedValues);
    setStatus(undefined);
    // A project added since the last save is gone now; do not stay on its address.
    if (route.view === 'project' && !saved.projects.some((p) => p.id === route.id)) {
      const first = saved.projects[0];
      navigate(first ? projectHash(first.id) : '#/', true);
    }
  };

  const save = async () => {
    // The permission request must start before the first await of this handler (user gesture).
    // It is only worth asking for if the configuration can be saved at all.
    const wanted = issues.length === 0 ? originPatterns(targetUrls(normalize(draft))).filter((o) => perm[o] !== 'granted') : [];
    const request = wanted.length > 0 ? permissions.request(wanted).catch(() => false) : undefined;
    setBusy(true);
    try {
      const result = await saveConfig(normalize(draft), storage);
      for (const t of result.projects.flatMap((p) => p.targets)) {
        for (const name of t.headers) {
          const v = values[t.id]?.[name];
          if (v !== undefined && v !== storedValues[t.id]?.[name]) await setHeaderValue(t.id, name, v, storage);
        }
      }
      const kept = pruneHeaderValues(result, values);
      setValues(kept);
      setStoredValues(kept);
      // Only revoke an origin that no remaining target in any project uses.
      const still = new Set(originPatterns(targetUrls(result)));
      const dropped = originPatterns(targetUrls(saved)).filter((o) => !still.has(o));
      if (dropped.length > 0) {
        await permissions.remove(dropped).catch(() => false);
        setPerm((p) => Object.fromEntries(Object.entries(p).filter(([o]) => !dropped.includes(o))));
      }
      setSaved(result);
      setDraft(result);
      setStatus({ kind: 'ok', text: t('options.status.saved') });
    } catch (e) {
      // The draft stays as it is, so no input is lost.
      if (e instanceof ConfigError) {
        setStatus({ kind: 'error', text: tn('options.status.invalid', Math.max(1, issues.length)) });
        // Move to the first marked input; the render with the message has to be done first.
        setTimeout(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 0);
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

  const summary = unmappedIssues(issues, selectedIndex);
  const projectName = (i: number) => draft.projects[i]?.name || t('options.projects.fallbackName', { n: i + 1 });

  return (
    <Shell sidebar={<Sidebar projects={draft.projects} current={current} dirty={dirty} onAdd={addProject} />}>
      {projectView && (
        <>
          <div className="options-bar">
            <Button variant="primary" onClick={save} disabled={busy}>
              {t('options.save')}
            </Button>
            <Button onClick={discard} disabled={!dirty || busy}>
              {t('options.discard')}
            </Button>
            {status ? (
              <Toast kind={status.kind === 'ok' ? 'success' : 'error'} onDismiss={() => setStatus(undefined)}>
                {status.text}
              </Toast>
            ) : (
              <p role="status" className="q-hint">{dirty ? t('options.status.dirty') : ''}</p>
            )}
          </div>
          {summary.length > 0 && (
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
              count={draft.projects.length}
              onMove={(d) => edit(moveItem(draft.projects, selectedIndex, d))}
              onDelete={deleteSelected}
              issues={issues}
              headerValues={values}
              onHeaderValues={(v) => { setValues(v); setStatus(undefined); }}
              permissionStatus={permissionStatus}
              onRequestPermission={requestOne}
              onChange={(p) => edit(draft.projects.map((x, i) => (i === selectedIndex ? p : x)))}
            />
          )}
        </>
      )}
      {route.view === 'settings' && <SettingsSection />}
      {route.view === 'import-export' && <ImportExport storage={storage} permissions={permissions} dirty={dirty} onImported={onReload} />}
    </Shell>
  );
}
