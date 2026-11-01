import { describe, expect, it } from 'vitest';
import config, { buildManifest, E2E_HOST_PERMISSIONS } from '../wxt.config';

describe('manifest policy', () => {
  it('declares only the fixed permissions and no fixed host permissions in release modes', () => {
    for (const mode of ['production', 'development', 'staging']) {
      const manifest = buildManifest(mode) as Record<string, unknown>;
      expect(manifest.permissions).toEqual(['activeTab', 'scripting', 'storage']);
      expect(manifest.optional_host_permissions).toEqual(['https://*/*', 'http://*/*']);
      expect(manifest).not.toHaveProperty('host_permissions');
    }
  });

  it('adds only the two local origins in the e2e build', () => {
    const manifest = buildManifest('e2e') as Record<string, unknown>;
    expect(manifest.host_permissions).toEqual(['http://localhost/*', 'http://127.0.0.1/*']);
    expect(E2E_HOST_PERMISSIONS).toHaveLength(2);
    expect(manifest.permissions).toEqual(['activeTab', 'scripting', 'storage']);
  });

  it('resolves the WXT config per mode to the same manifests', async () => {
    const resolve = config.manifest as unknown as (env: { mode: string }) => unknown;
    expect(await resolve({ mode: 'production' })).toEqual(buildManifest('production'));
    expect(await resolve({ mode: 'e2e' })).toEqual(buildManifest('e2e'));
  });
});
