// Fails if the built release manifest carries host_permissions or permissions beyond the fixed four.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const FIXED_PERMISSIONS = ['activeTab', 'scripting', 'storage', 'sidePanel'];

/** Returns a list of problems; empty means the manifest is release-conformant. */
export function checkManifest(manifest) {
  const problems = [];
  if ('host_permissions' in manifest) problems.push('host_permissions must not be present in a release build');
  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  for (const p of permissions) {
    if (!FIXED_PERMISSIONS.includes(p)) problems.push(`unexpected permission: ${String(p)}`);
  }
  for (const p of FIXED_PERMISSIONS) {
    if (!permissions.includes(p)) problems.push(`missing permission: ${p}`);
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2] ?? '.output/chrome-mv3/manifest.json';
  const problems = checkManifest(JSON.parse(readFileSync(file, 'utf8')));
  if (problems.length > 0) {
    console.error(`Manifest check failed for ${file}:\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
  console.log(`Manifest check passed for ${file}`);
}
