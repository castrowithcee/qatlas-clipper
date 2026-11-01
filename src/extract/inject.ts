import { browser } from 'wxt/browser';
import type { Project } from '../config/schema';
import type { ReadResult } from './result';

// Shared with entrypoints/reader.ts.
export const READER_GLOBAL = '__qatlasRead';

export type ReadErrorKind = 'unsupported' | 'no-access' | 'failed';
export type ReaderOutcome = { ok: true; result: ReadResult } | { ok: false; kind: 'unsupported' | 'failed' };
export type ReadTabResult = { ok: true; result: ReadResult } | { ok: false; kind: ReadErrorKind; message: string };

const MESSAGES: Record<ReadErrorKind, string> = {
  unsupported: 'This page cannot be read (browser-internal page, extension store or PDF viewer).',
  'no-access': 'No access to this page. Open the extension from the page you want to read.',
  failed: 'Reading the page failed.',
};
const fail = (kind: ReadErrorKind): ReadTabResult => ({ ok: false, kind, message: MESSAGES[kind] });

/** Whether the URL can never be injected into (or is a PDF viewer). */
export function isUnreadableUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return true;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return true;
  const host = u.hostname.toLowerCase();
  if (host === 'chromewebstore.google.com') return true;
  if (host === 'chrome.google.com' && u.pathname.startsWith('/webstore')) return true;
  return u.pathname.toLowerCase().endsWith('.pdf');
}

/**
 * Injects the reader into the tab (activeTab grant required) and returns its result. Reads only on call.
 * Only structure needed for matching is sent to the page: targets (header names) are stripped, tokens never leave
 * chrome.storage.local.
 */
export async function readTab(tabId: number, projects: Project[], projectId?: string): Promise<ReadTabResult> {
  try {
    const tab = await browser.tabs.get(tabId);
    if (!tab.url) return fail('no-access');
    if (isUnreadableUrl(tab.url)) return fail('unsupported');

    const safeProjects = projects.map((p) => ({ ...p, targets: [] }));
    await browser.scripting.executeScript({ target: { tabId }, files: ['/reader.js'] });
    const [injection] = await browser.scripting.executeScript({
      target: { tabId },
      args: [READER_GLOBAL, safeProjects, projectId ?? null],
      func: (globalName: string, p: unknown, id: string | null) => {
        const read = (globalThis as Record<string, unknown>)[globalName];
        if (typeof read !== 'function') return { ok: false, kind: 'failed' };
        return (read as (a: unknown, b?: string) => unknown)(p, id ?? undefined);
      },
    });
    const outcome = injection?.result as ReaderOutcome | undefined;
    if (!outcome) return fail('failed');
    return outcome.ok ? outcome : fail(outcome.kind);
  } catch {
    // Messages never include the thrown error text, which may contain page details.
    return fail('failed');
  }
}
