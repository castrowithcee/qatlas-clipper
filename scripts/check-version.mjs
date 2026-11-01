// Fails unless the release tag is exactly "v" + the package.json version in strict MAJOR.MINOR.PATCH form.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const STRICT_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Returns an error message, or null when tag and version match. Pre-release tags are rejected on purpose. */
export function checkVersion(tag, version) {
  if (typeof tag !== 'string' || !STRICT_TAG.test(tag)) {
    return `Tag "${String(tag)}" is not of the form vMAJOR.MINOR.PATCH`;
  }
  if (tag !== `v${version}`) {
    return `Tag "${tag}" does not match package.json version "${version}" (expected "v${version}")`;
  }
  return null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tag = process.argv[2];
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const error = checkVersion(tag, pkg.version);
  if (error) {
    console.error(`Version check failed: ${error}`);
    process.exit(1);
  }
  console.log(`Version check passed: ${tag}`);
}
