import type { StorageArea } from '../config';
import { defaultDraftStorage } from '../popup/draft';
import type { SendOutcome } from './response';

export const RESULTS_KEY = 'sendResults';
export const IN_FLIGHT_KEY = 'sendInFlight';
/** Number of tab URLs whose last outcomes are kept; the oldest are dropped. */
export const MAX_RESULT_URLS = 20;
const MAX_IN_FLIGHT = 100;
/** A marker older than this is stale (e.g. the worker was stopped mid-send) and ignored. */
export const IN_FLIGHT_TTL_MS = 30_000;

/** storage.session, like the drafts: results are not persisted across browser restarts. */
export const defaultResultStorage = defaultDraftStorage;

export interface StoredResult {
  outcome: SendOutcome;
  /** ISO 8601 time of completion. */
  at: string;
}

interface UrlResults {
  url: string;
  targets: Record<string, StoredResult>;
}
interface InFlight {
  url: string;
  targetId: string;
  startedAt: number;
}

export interface SendState {
  /** targetId -> last outcome for this URL */
  results: Record<string, StoredResult>;
  /** target ids with a send currently running for this URL */
  inFlight: string[];
}

function isUrlResults(v: unknown): v is UrlResults {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.url === 'string' && typeof r.targets === 'object' && r.targets !== null;
}
function isInFlight(v: unknown): v is InFlight {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.url === 'string' && typeof r.targetId === 'string' && typeof r.startedAt === 'number';
}

async function loadResultList(storage: StorageArea): Promise<UrlResults[]> {
  const raw = (await storage.get([RESULTS_KEY]))[RESULTS_KEY];
  return Array.isArray(raw) ? raw.filter(isUrlResults) : [];
}
async function loadInFlight(storage: StorageArea, now: number): Promise<InFlight[]> {
  const raw = (await storage.get([IN_FLIGHT_KEY]))[IN_FLIGHT_KEY];
  return Array.isArray(raw) ? raw.filter(isInFlight).filter((m) => now - m.startedAt < IN_FLIGHT_TTL_MS) : [];
}

export async function loadResults(storage: StorageArea, url: string, now: () => number = Date.now): Promise<SendState> {
  const [list, flights] = await Promise.all([loadResultList(storage), loadInFlight(storage, now())]);
  return {
    results: list.find((r) => r.url === url)?.targets ?? {},
    inFlight: flights.filter((m) => m.url === url).map((m) => m.targetId),
  };
}

// Read-modify-write on one storage key is not atomic; serialize all writers of this worker.
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

/** Sets the in-flight marker; false if a (non-stale) marker for this URL and target already exists. */
export function beginSend(storage: StorageArea, url: string, targetId: string, now: () => number = Date.now): Promise<boolean> {
  return serialized(async () => {
    const flights = await loadInFlight(storage, now());
    if (flights.some((m) => m.url === url && m.targetId === targetId)) return false;
    const next = [{ url, targetId, startedAt: now() }, ...flights].slice(0, MAX_IN_FLIGHT);
    await storage.set({ [IN_FLIGHT_KEY]: next });
    return true;
  });
}

/** Stores the outcome as the latest for URL and target and clears the in-flight marker in the same step. */
export function finishSend(
  storage: StorageArea,
  url: string,
  targetId: string,
  outcome: SendOutcome,
  now: () => number = Date.now,
): Promise<void> {
  return serialized(async () => {
    const [list, flights] = await Promise.all([loadResultList(storage), loadInFlight(storage, now())]);
    const current = list.find((r) => r.url === url);
    const entry: UrlResults = {
      url,
      targets: { ...current?.targets, [targetId]: { outcome, at: new Date(now()).toISOString() } },
    };
    const rest = list.filter((r) => r.url !== url);
    await storage.set({
      [RESULTS_KEY]: [entry, ...rest].slice(0, MAX_RESULT_URLS),
      [IN_FLIGHT_KEY]: flights.filter((m) => !(m.url === url && m.targetId === targetId)),
    });
  });
}
