import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    // Two full runs may share the host at once; half the cores each avoids oversubscription.
    maxWorkers: '50%',
    // user-event sequences in happy-dom take up to about 7 s under that load.
    testTimeout: 15000,
  },
});
