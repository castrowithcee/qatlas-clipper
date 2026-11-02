import { useCallback, useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { defaultStorage, loadConfig, type Config, type Field, type StorageArea } from '../config';
import { readTab, type ReadTabResult } from '../extract/inject';
import type { ReadResult } from '../extract/result';
import { useI18n } from '../settings';
import { Button } from '../ui/components';
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
import { deleteMapping } from '../options/draft';
import { normalizeDomain } from '../picker/mapping';
import { addCapturedField, updateProject, updateProjectField } from './projectFields';
import { requestOptionsFocus } from '../options/focus';
import { FieldForm, type FieldPatch } from './FieldForm';
import { Header } from './Header';
import { MissingHint, ResultView } from './Outcome';
import { BlockedView, LoadingView, NoPermissionView, NoProjectsView, NoTargetView, type BlockReason } from './States';
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
  /** 'sidepanel' fills the panel width and stays open while the picker runs (no close). */
  variant?: 'popup' | 'sidepanel';
  /** Increasing this number reads the active tab and the configuration again. */
  reloadToken?: number;
}

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
  | { phase: 'blocked'; reason: BlockReason }
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
  variant = 'popup',
  reloadToken = 0,
}: PopupDeps) {
  const rootClass = variant === 'sidepanel' ? 'popup popup-panel' : 'popup';
  // Resolved once: default areas are new objects per call and must not retrigger the load effect.
  const [storage] = useState(() => storageProp ?? defaultStorage());
  const [draftStorage] = useState(() => draftProp ?? defaultDraftStorage());
  const [resultStorage] = useState(() => resultProp ?? defaultResultStorage());
  const { t } = useI18n();
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [reload, setReload] = useState(0);
  const [sendState, setSendState] = useState<SendState>({ results: {}, inFlight: [] });
  const [hint, setHint] = useState<{ targetId: string; kind: 'missing' | 'permission'; keys: string[] } | null>(null);
  // Synchronous guard: state updates are too late to stop a fast double click.
  const sending = useRef(new Set<string>());
  const [sendingIds, setSendingIds] = useState<string[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const requestId = useRef(0);
  // Set on selection: state.projectId follows only after the tab re-read, too late for the options handoff.
  const chosenProject = useRef<string | null>(null);
  const writes = useRef<Promise<void>>(Promise.resolve());
  // Menu changes run one after another so each re-read sees the configuration its save produced.
  const menuOps = useRef<Promise<void>>(Promise.resolve());

  const persist = useCallback(
    (next: Draft) => {
      setDraft(next);
      writes.current = writes.current.then(() => saveDraft(draftStorage, next)).catch(() => undefined);
    },
    [draftStorage],
  );

  useEffect(() => {
    const id = ++requestId.current;
    chosenProject.current = null;
    const stale = () => id !== requestId.current;
    (async () => {
      try {
        const tab = await getActiveTab();
        if (tab?.id === undefined) return setState({ phase: 'blocked', reason: 'no-tab' });
        const config = await loadConfig(storage);
        const url = tab.url ?? '';
        const [saved, last] = await Promise.all([loadDraft(draftStorage, url), storage.get([LAST_PROJECT_KEY])]);
        const lastId = typeof last[LAST_PROJECT_KEY] === 'string' ? (last[LAST_PROJECT_KEY] as string) : undefined;
        let result = await read(tab.id, config.projects);
        if (stale()) return;
        if (!result.ok) return setState({ phase: 'blocked', reason: result.kind });
        const projectId = pickProject(config.projects, result.result.matchingProjects.map((p) => p.id), saved.projectId, lastId);
        if (projectId && projectId !== result.result.selectedProjectId) {
          const again = await read(tab.id, config.projects, projectId);
          if (stale()) return;
          if (!again.ok) return setState({ phase: 'blocked', reason: again.kind });
          result = again;
        }
        setDraft(saved);
        const stored = await loadSendState(url, resultStorage).catch(() => undefined);
        if (stale()) return;
        if (stored) setSendState(stored);
        setState({ phase: 'ready', config, tabId: tab.id, tabUrl: url, read: result.result, projectId });
      } catch {
        if (!stale()) setState({ phase: 'blocked', reason: 'load-failed' });
      }
    })();
    // Invalidates in-flight loads on unmount.
    return () => {
      requestId.current = -1;
    };
  }, [storage, draftStorage, resultStorage, getActiveTab, read, reload, reloadToken]);

  const tabUrl = state.phase === 'ready' ? state.tabUrl : '';
  const anyInFlight = sendState.inFlight.length > 0;
  useEffect(() => {
    if (state.phase !== 'ready' || !anyInFlight) return;
    const timer = setInterval(() => {
      void loadSendState(tabUrl, resultStorage).then(setSendState, () => undefined);
    }, pollMs);
    return () => clearInterval(timer);
  }, [state.phase, anyInFlight, tabUrl, resultStorage, pollMs]);

  // The selected project is handed over through storage.session; failing to write must not block opening.
  const readyProjectId = state.phase === 'ready' ? state.projectId : null;
  const openOpts = () =>
    void (async () => {
      const focusId = readyProjectId === null ? null : (chosenProject.current ?? readyProjectId);
      if (focusId) await requestOptionsFocus(draftStorage, focusId).catch(() => undefined);
      await openOptions();
    })();
  if (state.phase === 'loading') return <main className={rootClass}><LoadingView /></main>;
  if (state.phase === 'blocked') {
    return (
      <main className={rootClass}>
        <BlockedView
          reason={state.reason}
          onOpenOptions={openOpts}
          onRetry={() => {
            setState({ phase: 'loading' });
            setReload((n) => n + 1);
          }}
        />
      </main>
    );
  }

  const { config, tabId, tabUrl: stateUrl, read: page, projectId } = state;
  if (config.projects.length === 0 || projectId === null) {
    return (
      <main className={rootClass}>
        <NoProjectsView onOpenOptions={openOpts} />
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
    chosenProject.current = id;
    persist({ ...current, projectId: id });
    void Promise.resolve(storage.set({ [LAST_PROJECT_KEY]: id })).catch(() => undefined);
    const result = await read(tabId, config.projects, id);
    if (rid !== requestId.current) return;
    if (!result.ok) return setState({ phase: 'blocked', reason: result.kind });
    setState({ ...state, read: result.result, projectId: id });
  };

  const map = async (field: Field) => {
    setActionError(null);
    try {
      await pick(tabId, projectId, field.key);
      // Closing ends the popup's context; pending draft writes must land first. The side panel stays open.
      await writes.current;
      if (variant === 'popup') close();
    } catch {
      setActionError(t('popup.field.pickFailed'));
    }
  };

  // Saved before the picker starts: saveMapping rejects unknown fields. Rejects when saving failed.
  const addField = async (label: string) => {
    setActionError(null);
    const { config: saved, field } = await addCapturedField(storage, projectId, label);
    setState((s) => (s.phase === 'ready' ? { ...s, config: saved } : s));
    await map(field);
  };

  // Save through the merge-safe path, then read the page again with the saved configuration. Drafts stay untouched.
  const saveAndReread = (save: () => Promise<Config>) => {
    setActionError(null);
    menuOps.current = menuOps.current.then(async () => {
      let saved: Config;
      try {
        saved = await save();
      } catch {
        setActionError(t('popup.menu.failed'));
        return;
      }
      const rid = ++requestId.current;
      try {
        const result = await read(tabId, saved.projects, projectId);
        if (rid !== requestId.current) return;
        if (!result.ok) return setState({ phase: 'blocked', reason: result.kind });
        setState((s) => (s.phase === 'ready' ? { ...s, config: saved, read: result.result } : s));
      } catch {
        if (rid === requestId.current) setState({ phase: 'blocked', reason: 'load-failed' });
      }
    });
  };

  const siteDomain = (() => {
    try {
      return normalizeDomain(page.url);
    } catch {
      return null;
    }
  })();
  const mappedKeys =
    siteDomain !== null && Object.hasOwn(project.siteMappings, siteDomain)
      ? project.fields.filter((f) => Object.hasOwn(project.siteMappings[siteDomain]!, f.key)).map((f) => f.key)
      : [];

  const updateField = (field: Field, patch: FieldPatch) =>
    saveAndReread(() => updateProjectField(storage, projectId, field.key, (f) => ({ ...f, ...patch })));
  const removeMapping = (field: Field) => {
    if (siteDomain === null) return;
    saveAndReread(() => updateProject(storage, projectId, (p) => deleteMapping(p, siteDomain, field.key)));
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
          content: page.content,
          contentFormat: page.contentFormat,
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
  const header = (
    <Header
      title={page.title}
      url={page.url}
      projects={ordered}
      matchingIds={page.matchingProjects.map((p) => p.id)}
      value={projectId}
      onChange={(id) => void changeProject(id)}
      onOpenOptions={openOpts}
    />
  );

  if (project.targets.length === 0) {
    return (
      <main className={rootClass}>
        {header}
        <NoTargetView onOpenOptions={openOpts} />
      </main>
    );
  }

  return (
    <main className={rootClass}>
      {header}
      {actionError && <p role="alert" className="popup-error">{actionError}</p>}
      <FieldForm
        key={projectId}
        fields={project.fields}
        found={page.fields}
        edits={edits}
        invalidKeys={missingKeys}
        note={current.note}
        onChange={(key, v) => {
          setHint((h) => (h?.kind === 'missing' ? null : h));
          persist({ ...current, projectId, fields: { ...current.fields, [projectId]: { ...edits, [key]: v } } });
        }}
        onNote={(note) => persist({ ...current, projectId, note })}
        onPick={(field) => void map(field)}
        onAddField={addField}
        mappedKeys={mappedKeys}
        onUpdateField={updateField}
        onRemoveMapping={removeMapping}
      />
      <section aria-label={t('popup.send.section')} className="popup-send">
        {project.targets.map((target) => {
          const busy = sendingIds.includes(target.id) || sendState.inFlight.includes(target.id);
          const result = sendState.results[target.id];
          const h = hint?.targetId === target.id ? hint : null;
          const noPermission = h?.kind === 'permission' || result?.outcome.kind === 'no-permission';
          return (
            <div className="popup-target" key={target.id}>
              <Button variant="primary" className="popup-send-button" disabled={busy} aria-busy={busy} onClick={() => void sendTo(target)}>
                {busy ? (
                  <>
                    <span className="q-spinner popup-spinner" aria-hidden="true" />
                    {t('popup.send.busy')}
                  </>
                ) : (
                  t('popup.send.to', { name: target.name })
                )}
              </Button>
              {busy && <span role="status" className="popup-sr">{t('popup.send.busyTo', { name: target.name })}</span>}
              {h?.kind === 'missing' && <MissingHint />}
              {noPermission && <NoPermissionView onOpenOptions={openOpts} />}
              {result && !busy && <ResultView outcome={result.outcome} at={result.at} onRetry={() => void sendTo(target)} />}
            </div>
          );
        })}
      </section>
    </main>
  );
}
