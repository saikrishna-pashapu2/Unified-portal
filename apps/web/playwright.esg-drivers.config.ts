import { defineConfig, devices } from '@playwright/test';

// This mode mounts the production client with mock HTTP endpoints and never creates a user.
process.env.ESG_DRIVERS_ISOLATED_UI_TEST = '1';
export default defineConfig({
  testDir: './e2e', testMatch: 'esg-drivers.spec.ts', workers: 1, timeout: 45_000,
  use: { baseURL: 'http://127.0.0.1:4177', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'pnpm exec tsx scripts/esg-drivers-ui-test-server.mts', url: 'http://127.0.0.1:4177', reuseExistingServer: false, timeout: 60_000 },
});
