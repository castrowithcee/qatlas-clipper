import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { defaultStorage, loadConfig, type Config, type Field, type StorageArea } from '../config';
import type { FieldSource } from '../extract';
import { readTab, type ReadTabResult } from '../extract/inject';
import type { ReadResult } from '../extract/result';
import { defaultPermissions, originPattern, type PermissionsApi } from '../options/permissions';
import { startPicker } from '../picker/start';
import { buildPayload } from '../send/payload';
import { loadSendState, requestSend } from '../send/messages';
import type { SendOutcome } from '../send/response';
import { defaultResultStorage, type SendState, type StoredResult } from '../send/results';
import type { SendRequest } from '../send/send';
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
  /** Host permission check before sending. */
  permissions?: Pick<PermissionsApi, 'contains'>;
  /** Per-tab-URL send results and running sends (chrome.storage.session). */
  resultStorage?: StorageArea;
  send?: (req: SendRequest) => Promise<SendOutcome>;
  /** Re-read interval for the send state while a send is running. */
  pollMs?: number;
  close?: () => void;
}

const SOURCE_LABELS: Record<FieldSource, string> = {
  detect: 'Detected',
  schemaOrg: 'JSON-LD',
  meta: 'Meta tag',
  selector: 'Mapped selector',
  manual: 'Manual',
};

type TabRef = { id?: number; url?: string } | undefined;

/**
 * Playwright cannot open the real action popup bound to a page tab, so the e2e build accepts `?tabId=<n>`.
 * When disabled the parameter is ignored and always uses the active tab.
 */
export async function resolveTab(
  tabIdParam: boolean,
  search: string,
  api: { active: () => Promise<TabRef>; byId: (id: number) => Promise<TabRef> },
): Promise<TabRef> {
  if (tabIdParam) {
    const raw = new URLSearchParams(search).get('tabId');
    if (raw !== null && /^\d+$/.test(raw)) return api.byId(Number(raw));
  }
  return api.active();
}

const activeTab = async () => (await browser.tabs.query({ active: true, currentWindow: true }))[0];

// The literal comparison lets the bundler drop resolveTab (and the tabId handling) from release builds.
const defaultTab = () =>
  import.meta.env.MODE === 'e2e'
    ? resolveTab(true, window.location.search, { active: activeTab, byId: (id) => browser.tabs.get(id) })
    : activeTab();

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; config: Config; tabId: number; tabUrl: string; read: ReadResult; projectId: string | null };

export function PopupApp({
  storage: storageProp,
  draftStorage: draftProp,
  getActiveTab = defaultTab,
  read = readTab,
  pick = startPicker,
  openOptions = () => browser.runtime.openOptionsPage(),
  permissions = defaultPermissions,
  resultStorage: resultProp,
  send = requestSend,
  pollMs = 1000,
  close = () => window.close(),
}: PopupDeps) {
  // Resolved once: default areas are new objects per call and must not retrigger the load effect.
  const [storage] = useState(() => storageProp ?? defaultStorage());
  const [draftStorage] = useState(() => draftProp ?? defaultDraftStorage());
  const [resultStorage] = useState(() => resultProp ?? defaultResultStorage());
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [sendState, setSendState] = useState<SendState>({ results: {}, inFlight: [] });
  const [hint, setHint] = useState<{ targetId: string; kind: 'missing' | 'permission'; keys: string[] } | null>(null);
  // Synchronous guard: state updates are too late to stop a fast double click.
  const sending = useRef(new Set<string>());
  const [sendingIds, setSendingIds] = useState<string[]>([]);
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
        const stored = await loadSendState(url, resultStorage).catch(() => undefined);
        if (stale()) return;
        if (stored) setSendState(stored);
        setState({ phase: 'ready', config, tabId: tab.id, tabUrl: url, read: result.result, projectId });
      } catch {
        if (!stale()) setState({ phase: 'error', message: 'Loading the popup failed.' });
      }
    })();
    // Invalidates in-flight loads on unmount.
    return () => {
      requestId.current = -1;
    };
  }, [storage, draftStorage, resultStorage, getActiveTab, read]);

  const tabUrl = state.phase === 'ready' ? state.tabUrl : '';
  const anyInFlight = sendState.inFlight.length > 0;
  useEffect(() => {
    if (state.phase !== 'ready' || !anyInFlight) return;
    const timer = setInterval(() => {
      void loadSendState(tabUrl, resultStorage).then(setSendState, () => undefined);
    }, pollMs);
    return () => clearInterval(timer);
  }, [state.phase, anyInFlight, tabUrl, resultStorage, pollMs]);

  if (state.phase === 'loading') return <main><p role="status">Loading…</p></main>;
  if (state.phase === 'error') return <main><p role="alert" className="error">{state.message}</p></main>;

  const { config, tabId, tabUrl: stateUrl, read: page, projectId } = state;
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

  const valueOf = (key: string) => (edits[key] ?? page.fields[key]?.value ?? '');

  const sendTo = async (target: { id: string; name: string; url: string }) => {
    if (sending.current.has(target.id)) return;
    sending.current.add(target.id);
    setSendingIds([...sending.current]);
    setHint(null);
    try {
      const missing = project.fields.filter((f) => f.required && valueOf(f.key).trim() === '').map((f) => f.key);
      if (missing.length > 0) return setHint({ targetId: target.id, kind: 'missing', keys: missing });
      const pattern = originPattern(target.url);
      const allowed = pattern !== undefined && (await permissions.contains([pattern]).catch(() => false));
      if (!allowed) return setHint({ targetId: target.id, kind: 'permission', keys: [] });
      const values = Object.fromEntries(project.fields.map((f) => [f.key, valueOf(f.key)]));
      const outcome = await send({
        tabUrl: stateUrl,
        projectId,
        targetId: target.id,
        payload: buildPayload({
          project,
          target,
          url: page.url,
          title: page.title,
          values,
          contentMarkdown: page.contentMarkdown,
          note: current.note,
        }),
      });
      const stored: StoredResult = { outcome, at: new Date().toISOString() };
      // An in-flight rejection means another send owns the result; do not overwrite it.
      if (outcome.kind !== 'in-flight') {
        setSendState((s) => ({ ...s, results: { ...s.results, [target.id]: stored } }));
      }
      // Keep the local outcome if storage does not (yet) have one for the target.
      void loadSendState(stateUrl, resultStorage).then(
        (loaded) => setSendState((s) => ({ ...loaded, results: { ...s.results, ...loaded.results } })),
        () => undefined,
      );
    } finally {
      sending.current.delete(target.id);
      setSendingIds([...sending.current]);
    }
  };

  const missingKeys = hint?.kind === 'missing' ? hint.keys : [];

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
              invalid={missingKeys.includes(field.key)}
              onChange={(v) => {
                setHint((h) => (h?.kind === 'missing' ? null : h));
                persist({ ...current, projectId, fields: { ...current.fields, [projectId]: { ...edits, [field.key]: v } } });
              }}
              onMap={() => void map(field)}
            />
          );
        })}
        <NoteField value={current.note} onChange={(note) => persist({ ...current, projectId, note })} />
      </form>
      <section aria-label="Send">
        {project.targets.length === 0 && <p className="hint">This project has no targets. Add one in the options.</p>}
        {project.targets.map((target) => {
          const busy = sendingIds.includes(target.id) || sendState.inFlight.includes(target.id);
          const result = sendState.results[target.id];
          const h = hint?.targetId === target.id ? hint : null;
          const noPermission = h?.kind === 'permission' || result?.outcome.kind === 'no-permission';
          return (
            <div className="target" key={target.id}>
              <button type="button" disabled={busy} onClick={() => void sendTo(target)}>
                Send to {target.name}
              </button>
              {busy && <p role="status" className="hint">Sending…</p>}
              {h?.kind === 'missing' && (
                <p role="alert" className="error">
                  Required fields missing: {h.keys.map((k) => project.fields.find((f) => f.key === k)?.label ?? k).join(', ')}
                </p>
              )}
              {noPermission && (
                <p role="alert" className="error">
                  Permission for this target address is missing.{' '}
                  <button type="button" onClick={() => void openOptions()}>Open options to grant it</button>
                </p>
              )}
              {result && !busy && <ResultView outcome={result.outcome} />}
            </div>
          );
        })}
      </section>
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
  invalid: boolean;
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
          <select id={id} value={value} required={field.required} aria-invalid={props.invalid || undefined} onChange={(e) => props.onChange(e.target.value)}>
            <option value="">—</option>
            {value !== '' && !choice.includes(value) && <option value={value}>{value}</option>}
            {choice.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        ) : (
          <input id={id} type="text" value={value} required={field.required} aria-invalid={props.invalid || undefined} onChange={(e) => props.onChange(e.target.value)} />
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

/** Only http(s) URLs become links; webhook data is otherwise plain text. */
function linkOf(value: string): string | undefined {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : undefined;
  } catch {
    return undefined;
  }
}

function ResultView({ outcome }: { outcome: SendOutcome }) {
  if (outcome.kind === 'success') {
    const href = outcome.url === undefined ? undefined : linkOf(outcome.url);
    return (
      <div role="status" className="result">
        <p>Sent ({outcome.status})</p>
        {outcome.message && <p>{outcome.message}</p>}
        {outcome.url !== undefined &&
          (href ? (
            <p><a href={href} target="_blank" rel="noopener noreferrer">{href}</a></p>
          ) : (
            <p>{outcome.url}</p>
          ))}
      </div>
    );
  }
  if (outcome.kind === 'http-error') {
    return (
      <p role="alert" className="error">
        Error {outcome.status}{outcome.text ? `: ${outcome.text}` : ''}
      </p>
    );
  }
  if (outcome.kind === 'no-permission') return null;
  return <p role="alert" className="error">{outcome.message}</p>;
}
