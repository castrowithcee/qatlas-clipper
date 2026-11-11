import type { StorageArea } from '../config';

/** Device value in chrome.storage.local, apart from the exported configuration: project id -> target id. */
export const LAST_TARGETS_KEY = 'popupLastTargets';

export async function loadLastTargets(storage: StorageArea): Promise<Record<string, string>> {
  const raw = (await storage.get([LAST_TARGETS_KEY]))[LAST_TARGETS_KEY];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === 'string'));
}

export async function saveLastTarget(storage: StorageArea, projectId: string, targetId: string): Promise<Record<string, string>> {
  const next = { ...(await loadLastTargets(storage)), [projectId]: targetId };
  await storage.set({ [LAST_TARGETS_KEY]: next });
  return next;
}

/** The remembered target of this project if it still belongs to it, else the first one. */
export function pickTarget<T extends { id: string }>(targets: T[], last: Record<string, string>, projectId: string): T | undefined {
  const id = Object.hasOwn(last, projectId) ? last[projectId] : undefined;
  return targets.find((t) => t.id === id) ?? targets[0];
}

/** Host and the start of the path only: no credentials, query or fragment, which may carry secrets. */
export function shortAddress(url: string, max = 32): string {
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '' : u.pathname;
    const text = u.host + path;
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  } catch {
    return '';
  }
}
