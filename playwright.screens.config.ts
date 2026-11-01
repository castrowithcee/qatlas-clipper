import { defineConfig } from '@playwright/test';

// Component screenshots against the standalone gallery (e2e/gallery); separate from the extension flow tests of `npm run e2e`.
export default defineConfig({
  testDir: 'e2e/screens',
  outputDir: 'test-results/screens-run',
  reporter: [['list']],
  webServer: { command: 'npx vite --config e2e/gallery/vite.config.ts', url: 'http://127.0.0.1:5179', reuseExistingServer: false },
  use: { baseURL: 'http://127.0.0.1:5179', locale: 'en-US', viewport: { width: 760, height: 720 } },
  projects: [{ name: 'chromium', use: { channel: 'chromium', headless: true } }],
});
