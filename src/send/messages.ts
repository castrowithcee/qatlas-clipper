import { browser } from 'wxt/browser';
import type { StorageArea } from '../config';
import { failure, type SendOutcome } from './response';
import { loadResults, defaultResultStorage, type SendState } from './results';
import { sendToTarget, type SendDeps, type SendRequest } from './send';

export const SEND_MESSAGE_TYPE = 'qatlas-clipper/send';

export interface SendMessage extends SendRequest {
  type: typeof SEND_MESSAGE_TYPE;
}

/** Extracts only the known properties; anything else on the message (url, headers, ...) is ignored. */
export function parseSendMessage(message: unknown): SendMessage | undefined {
  if (typeof message !== 'object' || message === null) return undefined;
  const m = message as Record<string, unknown>;
  if (m.type !== SEND_MESSAGE_TYPE) return undefined;
  if (typeof m.tabUrl !== 'string' || typeof m.projectId !== 'string' || typeof m.targetId !== 'string') return undefined;
  return { type: SEND_MESSAGE_TYPE, tabUrl: m.tabUrl, projectId: m.projectId, targetId: m.targetId, payload: m.payload };
}

const OUTCOME_KINDS = new Set(['success', 'http-error', 'network-error', 'timeout', 'unknown-target', 'no-permission', 'invalid-request', 'in-flight', 'internal-error']);
const isOutcome = (v: unknown): v is SendOutcome =>
  typeof v === 'object' && v !== null && OUTCOME_KINDS.has((v as { kind?: unknown }).kind as string);

/** Popup side: asks the service worker to send; resolves with the outcome, never rejects. */
export async function requestSend(
  req: SendRequest,
  sendMessage: (m: unknown) => Promise<unknown> = (m) => browser.runtime.sendMessage(m),
): Promise<SendOutcome> {
  const message: SendMessage = { type: SEND_MESSAGE_TYPE, tabUrl: req.tabUrl, projectId: req.projectId, targetId: req.targetId, payload: req.payload };
  try {
    const res = await sendMessage(message);
    return isOutcome(res) ? res : failure('internal-error');
  } catch {
    return failure('internal-error');
  }
}

/** Popup side: last outcomes and running sends for a tab URL. */
export const loadSendState = (url: string, storage: StorageArea = defaultResultStorage()): Promise<SendState> => loadResults(storage, url);

export interface ListenerEnv {
  extensionId: string | undefined;
  /** Origin of this extension's own pages, e.g. "chrome-extension://<id>/". */
  extensionOrigin: string | undefined;
  deps?: SendDeps;
}
export interface MessageSender {
  id?: string;
  url?: string;
}

/**
 * runtime.onMessage listener. Only this extension's own pages are served: a content script shares the extension id
 * but reports the foreign page as its url, so the sender url must lie on the extension origin. Returning true keeps
 * the response channel open.
 */
export function createSendListener(env: ListenerEnv) {
  return (message: unknown, sender: MessageSender, sendResponse: (r: SendOutcome) => void): boolean => {
    const { extensionId, extensionOrigin } = env;
    if (!extensionId || !extensionOrigin || sender.id !== extensionId || !sender.url?.startsWith(extensionOrigin)) return false;
    const msg = parseSendMessage(message);
    if (!msg) return false;
    sendToTarget(msg, env.deps).then(sendResponse, () => sendResponse(failure('internal-error')));
    return true;
  };
}
