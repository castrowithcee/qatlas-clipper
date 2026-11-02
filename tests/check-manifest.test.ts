import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script without types
import { checkManifest } from '../scripts/check-manifest.mjs';

const ok = { permissions: ['activeTab', 'scripting', 'storage', 'sidePanel'], optional_host_permissions: ['https://*/*'] };

describe('release manifest check', () => {
  it('accepts the fixed permissions only', () => {
    expect(checkManifest(ok)).toEqual([]);
  });
  it('rejects host_permissions', () => {
    expect(checkManifest({ ...ok, host_permissions: ['http://localhost/*'] })).toHaveLength(1);
  });
  it('rejects a missing sidePanel permission', () => {
    expect(checkManifest({ ...ok, permissions: ['activeTab', 'scripting', 'storage'] })).toEqual(['missing permission: sidePanel']);
  });
  it('rejects extra permissions', () => {
    expect(checkManifest({ ...ok, permissions: [...ok.permissions, 'tabs'] })).toHaveLength(1);
  });
});
