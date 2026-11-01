import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script without types
import { checkVersion } from '../scripts/check-version.mjs';

describe('release version check', () => {
  it('accepts a tag equal to v + version', () => {
    expect(checkVersion('v1.0.0', '1.0.0')).toBeNull();
  });
  it('rejects a mismatching tag', () => {
    expect(checkVersion('v1.0.1', '1.0.0')).toMatch(/does not match/);
  });
  it.each(['v1.0', '1.0.0', 'v1.0.0-rc1', 'v1.0.0.0', 'v01.0.0', 'V1.0.0', ' v1.0.0', 'v1.0.0\n', '', undefined])(
    'rejects malformed tag %j',
    (tag) => {
      expect(checkVersion(tag, '1.0.0')).toMatch(/not of the form/);
    },
  );
});
