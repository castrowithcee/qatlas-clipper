import { useEffect, useMemo, useState } from 'react';
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
import { ItemButtons } from './fields';
import { moveItem, newProject, normalize, unmappedIssues, validate } from './draft';
import { SettingsSection } from '../settings/SettingsSection';
import './options.css';

type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; saved: Config; values: HeaderValues };

interface Props {
  /** Defaults to chrome.storage.local via the config module. */
  storage?: StorageArea;
  /** Defaults to browser.permissions. */
  permissions?: PermissionsApi;
}

export function OptionsApp({ storage, permissions = defaultPermissions }: Props) {
  const [loaded, setLoaded] = useState<Load>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadConfig(storage), loadHeaderValues(storage)])
      .then(([saved, values]) => !cancelled && setLoaded({ state: 'ready', saved, values }))
      .catch((e: unknown) => !cancelled && setLoaded({ state: 'error', message: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, [storage, attempt]);

  if (loaded.state === 'loading') return <main><p role="status">Loading configuration…</p></main>;
  if (loaded.state === 'error') {
    // The stored config is left untouched; nothing can be saved from this state.
    return (
      <main>
        <h1>qatlas-clipper options</h1>
        <div role="alert" className="error">
          <p>The stored configuration could not be loaded and was not changed.</p>
          <pre>{loaded.message}</pre>
        </div>
        <button type="button" onClick={() => { setLoaded({ state: 'loading' }); setAttempt((n) => n + 1); }}>
          Retry
        </button>
      </main>
    );
  }
  return <Editor key={attempt} initial={loaded.saved} initialValues={loaded.values} storage={storage} permissions={permissions} onReload={() => { setLoaded({ state: 'loading' }); setAttempt((n) => n + 1); }} />;
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
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [selectedId, setSelectedId] = useState<string | undefined>(initial.projects[0]?.id);
  const [confirmId, setConfirmId] = useState<string>();
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
  const selectedIndex = Math.max(0, draft.projects.findIndex((p) => p.id === selectedId));
  const selected = draft.projects[selectedIndex];
  const confirmProject = draft.projects.find((p) => p.id === confirmId);

  const edit = (projects: Project[]) => {
    setDraft({ ...draft, projects });
    setStatus(undefined);
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
      setStatus({ kind: 'ok', text: 'Saved.' });
    } catch (e) {
      // The draft stays as it is, so no input is lost.
      setStatus({ kind: 'error', text: e instanceof ConfigError ? 'Not saved: the configuration has problems.' : `Not saved: ${e instanceof Error ? e.message : String(e)}` });
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
  const projectName = (i: number) => draft.projects[i]?.name ?? `project ${i + 1}`;

  return (
    <main>
      <h1>qatlas-clipper options</h1>
      <div className="bar">
        <button type="button" onClick={save} disabled={busy}>Save changes</button>
        <button type="button" onClick={() => { setDraft(saved); setValues(storedValues); setStatus(undefined); setConfirmId(undefined); }} disabled={!dirty || busy}>
          Discard changes
        </button>
        <span role="status">{status?.text ?? (dirty ? 'Unsaved changes.' : '')}</span>
      </div>
      {summary.length > 0 && (
        <div role="alert" className="error">
          <p>Problems that block saving:</p>
          <ul>
            {summary.map((i, n) => {
              const m = /^projects\[(\d+)\]\.(.*)$/.exec(i.path);
              return <li key={n}>{m ? `${projectName(Number(m[1]))}: ${m[2]}` : i.path}: {i.message}</li>;
            })}
          </ul>
        </div>
      )}
      <SettingsSection />
      <ImportExport storage={storage} permissions={permissions} dirty={dirty} onImported={onReload} />
      <div className="layout">
        <nav aria-label="Projects">
          <h2>Projects</h2>
          <p className="hint">Order of matching projects: the first one is preselected.</p>
          {draft.projects.length === 0 && <p>No projects yet.</p>}
          <ol>
            {draft.projects.map((p, i) => (
              <li key={p.id}>
                <button type="button" aria-current={i === selectedIndex ? 'true' : undefined} onClick={() => setSelectedId(p.id)}>
                  {p.name || '(unnamed)'}
                </button>
                <ItemButtons
                  noun="project"
                  name={p.name}
                  index={i}
                  count={draft.projects.length}
                  onMove={(d) => edit(moveItem(draft.projects, i, d))}
                  onDelete={() => setConfirmId(p.id)}
                />
              </li>
            ))}
          </ol>
          {confirmProject && (
            <div role="alertdialog" aria-label="Confirm project deletion" className="confirm">
              <p>Delete project "{confirmProject.name}" with its scope, fields and site mappings?</p>
              <button type="button" onClick={() => { edit(draft.projects.filter((p) => p.id !== confirmProject.id)); setConfirmId(undefined); }}>
                Confirm delete
              </button>
              <button type="button" onClick={() => setConfirmId(undefined)}>Cancel</button>
            </div>
          )}
          <button type="button" onClick={() => { const p = newProject(); edit([...draft.projects, p]); setSelectedId(p.id); }}>
            Add project
          </button>
        </nav>
        <section aria-label="Project settings">
          {selected ? (
            <ProjectEditor
              key={selected.id}
              project={selected}
              index={selectedIndex}
              issues={issues}
              headerValues={values}
              onHeaderValues={(v) => { setValues(v); setStatus(undefined); }}
              permissionStatus={permissionStatus}
              onRequestPermission={requestOne}
              onChange={(p) => edit(draft.projects.map((x, i) => (i === selectedIndex ? p : x)))}
            />
          ) : (
            <p>Add a project to get started.</p>
          )}
        </section>
      </div>
    </main>
  );
}
