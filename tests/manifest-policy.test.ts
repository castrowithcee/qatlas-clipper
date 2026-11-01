import { describe, expect, it } from 'vitest';
import config from '../wxt.config';

describe('manifest policy', () => {
  it('declares only the fixed permissions and no fixed host permissions', () => {
    const manifest = config.manifest as Record<string, unknown>;
    expect(manifest.permissions).toEqual(['activeTab', 'scripting', 'storage']);
    expect(manifest.optional_host_permissions).toEqual(['https://*/*', 'http://*/*']);
    expect(manifest).not.toHaveProperty('host_permissions');
  });
});
