import { defineConfig } from 'wxt';

/** Origins granted at install time in the e2e build only; activeTab cannot be granted by a click in Playwright. */
export const E2E_HOST_PERMISSIONS = ['http://localhost/*', 'http://127.0.0.1/*'];

export function buildManifest(mode: string, versionName = process.env.VERSION_NAME) {
  return {
    name: 'qatlas-clipper',
    // Shown in chrome://extensions to tell development builds apart; Chrome's numeric version stays from package.json.
    ...(versionName ? { version_name: versionName } : {}),
    description: 'Reads page content and sends it to your own webhooks.',
    permissions: ['activeTab', 'scripting', 'storage'],
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    // Release builds (any mode other than "e2e") never carry fixed host permissions.
    ...(mode === 'e2e' ? { host_permissions: E2E_HOST_PERMISSIONS } : {}),
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      96: 'icon/96.png',
      128: 'icon/128.png',
    },
  };
}

// The e2e build lands in .output/chrome-mv3-e2e (WXT mode suffix), the release build in .output/chrome-mv3.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: ({ mode }) => buildManifest(mode),
});
