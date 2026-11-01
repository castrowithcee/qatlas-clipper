import { useEffect, useMemo, useState } from 'react';
import { ConfigError, loadConfig, saveConfig, type Config, type Project, type StorageArea } from '../config';
import { ProjectEditor } from './ProjectEditor';
import { ItemButtons } from './fields';
import { moveItem, newProject, normalize, unmappedIssues, validate } from './draft';
import './options.css';

type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; saved: Config };

interface Props {
  /** Defaults to chrome.storage.local via the config module. */
  storage?: StorageArea;
}

export function OptionsApp({ storage }: Props) {
  const [loaded, setLoaded] = useState<Load>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadConfig(storage)
      .then((saved) => !cancelled && setLoaded({ state: 'ready', saved }))
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
  return <Editor key={attempt} initial={loaded.saved} storage={storage} />;
}

function Editor({ initial, storage }: { initial: Config; storage?: StorageArea }) {
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [selectedId, setSelectedId] = useState<string | undefined>(initial.projects[0]?.id);
  const [confirmId, setConfirmId] = useState<string>();
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string }>();
  const [busy, setBusy] = useState(false);

  const issues = useMemo(() => validate(draft), [draft]);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);
  const selectedIndex = Math.max(0, draft.projects.findIndex((p) => p.id === selectedId));
  const selected = draft.projects[selectedIndex];
  const confirmProject = draft.projects.find((p) => p.id === confirmId);

  const edit = (projects: Project[]) => {
    setDraft({ ...draft, projects });
    setStatus(undefined);
  };

  const save = async () => {
    setBusy(true);
    try {
      const result = await saveConfig(normalize(draft), storage);
      setSaved(result);
      setDraft(result);
      setStatus({ kind: 'ok', text: 'Saved.' });
    } catch (e) {
      // The draft stays as it is, so no input is lost.
      setStatus({ kind: 'error', text: e instanceof ConfigError ? 'Not saved: the configuration has problems.' : `Not saved: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(false);
    }
  };

  const summary = unmappedIssues(issues, selectedIndex);
  const projectName = (i: number) => draft.projects[i]?.name ?? `project ${i + 1}`;

  return (
    <main>
      <h1>qatlas-clipper options</h1>
      <div className="bar">
        <button type="button" onClick={save} disabled={busy}>Save changes</button>
        <button type="button" onClick={() => { setDraft(saved); setStatus(undefined); setConfirmId(undefined); }} disabled={!dirty || busy}>
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
