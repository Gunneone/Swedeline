import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  workers: 1,
  webServer: {
    command: 'node scripts/serve.mjs 5179',
    port: 5179,
    reuseExistingServer: true,
  },
});
