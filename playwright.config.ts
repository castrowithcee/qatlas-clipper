import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e/specs',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    // Also covers the persistent context of the extension fixture.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { channel: 'chromium', headless: true } }],
});
