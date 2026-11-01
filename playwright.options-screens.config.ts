import { defineConfig } from '@playwright/test';

// Options page screenshots against the e2e extension build (`npm run screens:options`); not part of `npm run e2e`.
export default defineConfig({
  testDir: 'e2e/options-screens',
  outputDir: 'test-results/options-screens-run',
  reporter: [['list']],
  workers: 1,
  timeout: 90_000,
  projects: [{ name: 'chromium', use: { channel: 'chromium', headless: true } }],
});
