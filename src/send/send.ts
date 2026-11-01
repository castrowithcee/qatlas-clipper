import { defaultStorage, loadConfig, loadHeaderValues, type StorageArea } from '../config';
import { defaultPermissions, originPattern, type PermissionsApi } from '../options/permissions';
import { payloadSchema } from './payload';
import { evaluateResponse, failure, readLimitedText, type SendOutcome } from './response';
import { beginSend, defaultResultStorage, finishSend } from './results';

export const SEND_TIMEOUT_MS = 15_000;

export interface SendRequest {
  /** Tab URL the result is stored under. */
  tabUrl: string;
  projectId: string;
  targetId: string;
  /** Validated against the payload schema; the target address and headers are never taken from the request. */
  payload: unknown;
}

export interface SendDeps {
  /** chrome.storage.local: config and header values */
  config?: StorageArea;
  /** storage.session: results and in-flight markers */
  results?: StorageArea;
  permissions?: PermissionsApi;
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}

/** Runs one send and records it. Never throws; every failure is an outcome with a fixed message. */
export async function sendToTarget(req: SendRequest, deps: SendDeps = {}): Promise<SendOutcome> {
  const resultStorage = deps.results ?? defaultResultStorage();
  const now = deps.now ?? Date.now;
  if (!(await beginSend(resultStorage, req.tabUrl, req.targetId, now))) return failure('in-flight');
  let outcome: SendOutcome;
  try {
    outcome = await perform(req, deps);
  } catch {
    outcome = failure('internal-error');
  }
  try {
    await finishSend(resultStorage, req.tabUrl, req.targetId, outcome, now);
  } catch {
    // The outcome is still returned to the caller.
  }
  return outcome;
}

async function perform(req: SendRequest, deps: SendDeps): Promise<SendOutcome> {
  const parsed = payloadSchema.safeParse(req.payload);
  if (!parsed.success) return failure('invalid-request');
  const payload = parsed.data;
  if (payload.project.id !== req.projectId || payload.target.id !== req.targetId) return failure('invalid-request');

  const configStorage = deps.config ?? defaultStorage();
  const config = await loadConfig(configStorage);
  // The target must be declared by exactly this project; target ids are global.
  const target = config.projects.find((p) => p.id === req.projectId)?.targets.find((t) => t.id === req.targetId);
  if (!target) return failure('unknown-target');

  const pattern = originPattern(target.url);
  if (!pattern) return failure('unknown-target');
  if (!(await (deps.permissions ?? defaultPermissions).contains([pattern]))) return failure('no-permission');

  // Only this target's values, only names it still declares. Content-Type is fixed and cannot be overridden.
  const stored = (await loadHeaderValues(configStorage))[target.id] ?? {};
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  for (const name of target.headers) {
    const value = stored[name];
    if (value !== undefined && name.toLowerCase() !== 'content-type') headers[name] = value;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? SEND_TIMEOUT_MS);
  try {
    const res = await (deps.fetch ?? fetch)(target.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      redirect: 'error',
      credentials: 'omit',
      signal: controller.signal,
    });
    return evaluateResponse(res.status, await readLimitedText(res));
  } catch {
    // Error details can echo the request; only fixed messages leave this function.
    return failure(controller.signal.aborted ? 'timeout' : 'network-error');
  } finally {
    clearTimeout(timer);
  }
}
