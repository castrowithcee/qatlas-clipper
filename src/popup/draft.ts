import { browser } from 'wxt/browser';
import type { StorageArea } from '../config';

export const DRAFTS_KEY = 'popupDrafts';
export const LAST_PROJECT_KEY = 'popupLastProject';
/** Number of tab URLs whose user edits are kept; the oldest are dropped. */
export const MAX_DRAFTS = 20;

/** Only what the user changed; read values are never cached so a fresh mapping shows up after reopening. */
export interface Draft {
  url: string;
  projectId?: string;
  /** project id -> field key -> edited value */
  fields: Record<string, Record<string, string>>;
  note: string;
}

export const emptyDraft = (url: string): Draft => ({ url, fields: {}, note: '' });

/** storage.session keeps drafts out of persistent storage; fall back to local where it is unavailable. */
export const defaultDraftStorage = (): StorageArea =>
  ((browser.storage as { session?: unknown }).session ?? browser.storage.local) as unknown as StorageArea;

function isDraft(d: unknown): d is Draft {
  if (typeof d !== 'object' || d === null) return false;
  const r = d as Record<string, unknown>;
  return typeof r.url === 'string' && typeof r.note === 'string' && typeof r.fields === 'object' && r.fields !== null;
}

async function loadAll(storage: StorageArea): Promise<Draft[]> {
  const raw = (await storage.get([DRAFTS_KEY]))[DRAFTS_KEY];
  return Array.isArray(raw) ? raw.filter(isDraft) : [];
}

export async function loadDraft(storage: StorageArea, url: string): Promise<Draft> {
  return (await loadAll(storage)).find((d) => d.url === url) ?? emptyDraft(url);
}

/** Stores the draft as most recent entry and trims the list to MAX_DRAFTS. */
export async function saveDraft(storage: StorageArea, draft: Draft): Promise<void> {
  const rest = (await loadAll(storage)).filter((d) => d.url !== draft.url);
  await storage.set({ [DRAFTS_KEY]: [draft, ...rest].slice(0, MAX_DRAFTS) });
}

/** Matching projects first (project order kept), then the others. */
export function orderProjects<T extends { id: string }>(projects: T[], matchingIds: string[]): T[] {
  const m = new Set(matchingIds);
  return [...projects.filter((p) => m.has(p.id)), ...projects.filter((p) => !m.has(p.id))];
}

/** Draft choice, then first match, then last chosen, then first project; ids that no longer exist are skipped. */
export function pickProject(
  projects: { id: string }[],
  matchingIds: string[],
  draftId: string | undefined,
  lastId: string | undefined,
): string | null {
  const exists = (id: string | undefined) => (id !== undefined && projects.some((p) => p.id === id) ? id : undefined);
  return exists(draftId) ?? exists(matchingIds[0]) ?? exists(lastId) ?? projects[0]?.id ?? null;
}
