import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { defaultStorage, loadConfig, type Config, type Field, type StorageArea } from '../config';
import type { FieldSource } from '../extract';
import { readTab, type ReadTabResult } from '../extract/inject';
import type { ReadResult } from '../extract/result';
import { startPicker } from '../picker/start';
import {
  LAST_PROJECT_KEY,
  defaultDraftStorage,
  emptyDraft,
  loadDraft,
  orderProjects,
  pickProject,
  saveDraft,
  type Draft,
} from './draft';
import './popup.css';

export interface PopupDeps {
  /** Config and last chosen project (chrome.storage.local). */
  storage?: StorageArea;
  /** Per-tab-URL user edits (chrome.storage.session). */
  draftStorage?: StorageArea;
  getActiveTab?: () => Promise<{ id?: number; url?: string } | undefined>;
  read?: (tabId: number, projects: Config['projects'], projectId?: string) => Promise<ReadTabResult>;
  pick?: (tabId: number, projectId: string, fieldKey: string) => Promise<void>;
  openOptions?: () => Promise<void>;
  close?: () => void;
}

const SOURCE_LABELS: Record<FieldSource, string> = {
  schemaOrg: 'JSON-LD',
  meta: 'Meta tag',
  selector: 'Mapped selector',
  manual: 'Manual',
};

const defaultTab = async () => (await browser.tabs.query({ active: true, currentWindow: true }))[0];

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; config: Config; tabId: number; read: ReadResult; projectId: string | null };

export function PopupApp({
  storage: storageProp,
  draftStorage: draftProp,
  getActiveTab = defaultTab,
  read = readTab,
  pick = startPicker,
  openOptions = () => browser.runtime.openOptionsPage(),
  close = () => window.close(),
}: PopupDeps) {
  // Resolved once: default areas are new objects per call and must not retrigger the load effect.
  const [storage] = useState(() => storageProp ?? defaultStorage());
  const [draftStorage] = useState(() => draftProp ?? defaultDraftStorage());
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const requestId = useRef(0);
  const writes = useRef<Promise<void>>(Promise.resolve());

  const persist = useCallback(
    (next: Draft) => {
      setDraft(next);
      writes.current = writes.current.then(() => saveDraft(draftStorage, next)).catch(() => undefined);
    },
    [draftStorage],
  );

  useEffect(() => {
    const id = ++requestId.current;
    const stale = () => id !== requestId.current;
    (async () => {
      try {
        const tab = await getActiveTab();
        if (tab?.id === undefined) return setState({ phase: 'error', message: 'No active tab found.' });
        const config = await loadConfig(storage);
        const url = tab.url ?? '';
        const [saved, last] = await Promise.all([loadDraft(draftStorage, url), storage.get([LAST_PROJECT_KEY])]);
        const lastId = typeof last[LAST_PROJECT_KEY] === 'string' ? (last[LAST_PROJECT_KEY] as string) : undefined;
        let result = await read(tab.id, config.projects);
        if (stale()) return;
        if (!result.ok) return setState({ phase: 'error', message: result.message });
        const projectId = pickProject(config.projects, result.result.matchingProjects.map((p) => p.id), saved.projectId, lastId);
        if (projectId && projectId !== result.result.selectedProjectId) {
          const again = await read(tab.id, config.projects, projectId);
          if (stale()) return;
          if (!again.ok) return setState({ phase: 'error', message: again.message });
          result = again;
        }
        setDraft(saved);
        setState({ phase: 'ready', config, tabId: tab.id, read: result.result, projectId });
      } catch {
        if (!stale()) setState({ phase: 'error', message: 'Loading the popup failed.' });
      }
    })();
    // Invalidates in-flight loads on unmount.
    return () => {
      requestId.current = -1;
    };
  }, [storage, draftStorage, getActiveTab, read]);

  if (state.phase === 'loading') return <main><p role="status">Loading…</p></main>;
  if (state.phase === 'error') return <main><p role="alert" className="error">{state.message}</p></main>;

  const { config, tabId, read: page, projectId } = state;
  if (config.projects.length === 0 || projectId === null) {
    return (
      <main>
        <p>No projects configured yet.</p>
        <button type="button" onClick={() => void openOptions()}>Open options</button>
      </main>
    );
  }
  const project = config.projects.find((p) => p.id === projectId)!;
  const current = draft ?? emptyDraft(page.url);
  const edits = current.fields[projectId] ?? {};
  const ordered = orderProjects(config.projects, page.matchingProjects.map((p) => p.id));

  const changeProject = async (id: string) => {
    setActionError(null);
    const rid = ++requestId.current;
    persist({ ...current, projectId: id });
    void Promise.resolve(storage.set({ [LAST_PROJECT_KEY]: id })).catch(() => undefined);
    const result = await read(tabId, config.projects, id);
    if (rid !== requestId.current) return;
    if (!result.ok) return setState({ phase: 'error', message: result.message });
    setState({ ...state, read: result.result, projectId: id });
  };

  const map = async (field: Field) => {
    setActionError(null);
    try {
      await pick(tabId, projectId, field.key);
      // Closing ends the popup's context; pending draft writes must land first.
      await writes.current;
      close();
    } catch {
      setActionError('Starting the picker failed.');
    }
  };

  return (
    <main>
      <ProjectSelect
        projects={ordered}
        matchingIds={page.matchingProjects.map((p) => p.id)}
        value={projectId}
        onChange={(id) => void changeProject(id)}
      />
      <dl className="page">
        <dt>Title</dt>
        <dd>{page.title}</dd>
        <dt>URL</dt>
        <dd className="url">{page.url}</dd>
      </dl>
      {actionError && <p role="alert" className="error">{actionError}</p>}
      <form onSubmit={(e) => e.preventDefault()}>
        {project.fields.map((field) => {
          const edited = edits[field.key];
          const found = page.fields[field.key];
          const value = edited ?? found?.value ?? '';
          const source = edited !== undefined ? 'manual' : (found?.source ?? 'manual');
          return (
            <FieldRow
              key={`${projectId}:${field.key}`}
              field={field}
              value={value}
              source={source}
              onChange={(v) =>
                persist({ ...current, projectId, fields: { ...current.fields, [projectId]: { ...edits, [field.key]: v } } })
              }
              onMap={() => void map(field)}
            />
          );
        })}
        <NoteField value={current.note} onChange={(note) => persist({ ...current, projectId, note })} />
      </form>
    </main>
  );
}

function ProjectSelect(props: {
  projects: { id: string; name: string }[];
  matchingIds: string[];
  value: string;
  onChange: (id: string) => void;
}) {
  const id = useId();
  return (
    <div className="row">
      <label htmlFor={id}>Project</label>
      <select id={id} value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        {props.projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {props.matchingIds.includes(p.id) ? '' : ' (no match)'}
          </option>
        ))}
      </select>
    </div>
  );
}

function FieldRow(props: {
  field: Field;
  value: string;
  source: FieldSource;
  onChange: (v: string) => void;
  onMap: () => void;
}) {
  const { field, value, source } = props;
  const id = useId();
  const choice = field.sources.manual?.type === 'choice' ? field.sources.manual.values : null;
  return (
    <div className="row">
      <label htmlFor={id}>
        {field.label}
        {field.required && <span aria-hidden="true"> *</span>}
      </label>
      <div className="input-line">
        {choice ? (
          <select id={id} value={value} required={field.required} onChange={(e) => props.onChange(e.target.value)}>
            <option value="">—</option>
            {value !== '' && !choice.includes(value) && <option value={value}>{value}</option>}
            {choice.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        ) : (
          <input id={id} type="text" value={value} required={field.required} onChange={(e) => props.onChange(e.target.value)} />
        )}
        <button type="button" aria-label={`Map ${field.label}`} onClick={props.onMap}>Map</button>
      </div>
      <p className="hint">Source: {SOURCE_LABELS[source]}</p>
    </div>
  );
}

function NoteField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div className="row">
      <label htmlFor={id}>Note</label>
      <textarea id={id} rows={3} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
