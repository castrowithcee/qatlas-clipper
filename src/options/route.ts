import { useSyncExternalStore } from 'react';

/** Views of the options page; each has its own address in the URL hash. */
export type Route = { view: 'project'; id: string } | { view: 'tags' } | { view: 'settings' } | { view: 'import-export' } | { view: 'help' } | { view: 'home' };

/** Unknown or malformed hashes fall back to `home`, which shows the first project. */
export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '').replace(/\/+$/, '');
  if (path === 'tags') return { view: 'tags' };
  if (path === 'settings') return { view: 'settings' };
  if (path === 'import-export') return { view: 'import-export' };
  if (path === 'help') return { view: 'help' };
  const m = /^projects\/([^/]+)$/.exec(path);
  if (m?.[1]) {
    try {
      const id = decodeURIComponent(m[1]);
      if (id) return { view: 'project', id };
    } catch {
      // Malformed escape sequence: treated like an unknown address.
    }
  }
  return { view: 'home' };
}

export const projectHash = (id: string): string => `#/projects/${encodeURIComponent(id)}`;
export const TAGS_HASH = '#/tags';
export const SETTINGS_HASH = '#/settings';
export const IMPORT_EXPORT_HASH = '#/import-export';
export const HELP_HASH = '#/help';

/** `replace` keeps the history free of addresses that no longer exist, e.g. a deleted project. */
export function navigate(hash: string, replace = false): void {
  if (replace) {
    // replaceState fires no hashchange event, so subscribers are notified by hand.
    history.replaceState(null, '', hash);
    window.dispatchEvent(new Event('hashchange'));
  } else {
    window.location.hash = hash;
  }
}

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

export function useHash(): string {
  return useSyncExternalStore(subscribe, () => window.location.hash);
}
