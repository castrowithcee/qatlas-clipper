import { browser } from 'wxt/browser';

/** Subset of browser.permissions; injectable for tests. */
export interface PermissionsApi {
  contains(origins: string[]): Promise<boolean>;
  request(origins: string[]): Promise<boolean>;
  remove(origins: string[]): Promise<boolean>;
}

export const defaultPermissions: PermissionsApi = {
  contains: (origins) => browser.permissions.contains({ origins }),
  request: (origins) => browser.permissions.request({ origins }),
  remove: (origins) => browser.permissions.remove({ origins }),
};

export type PermissionStatus = 'granted' | 'denied' | 'unchecked';

/** Match pattern for the origin of a URL, or undefined if the URL does not parse. */
export function originPattern(url: string): string | undefined {
  try {
    const u = new URL(url.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? `${u.origin}/*` : undefined;
  } catch {
    return undefined;
  }
}

export function originPatterns(urls: string[]): string[] {
  return [...new Set(urls.map(originPattern).filter((o): o is string => o !== undefined))];
}
