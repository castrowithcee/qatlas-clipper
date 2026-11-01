import { defineConfig } from '@playwright/test';

// Popup screenshots against the e2e extension build (`npm run screens:popup`); not part of `npm run e2e`.
export default defineConfig({
  testDir: 'e2e/popup-screens',
  outputDir: 'test-results/popup-screens-run',
  reporter: [['list']],
  workers: 1,
  timeout: 90_000,
  projects: [{ name: 'chromium', use: { channel: 'chromium', headless: true } }],
});
