import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: ['article-search.spec.ts', 'credit-article-search.spec.ts'],
  workers: 1,
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:4183', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: {
    ...devices['Desktop Chrome'],
    ...(process.env.ARTICLE_SEARCH_BROWSER_CHANNEL ? { channel: process.env.ARTICLE_SEARCH_BROWSER_CHANNEL } : {}),
  } }],
  webServer: {
    command: 'pnpm exec tsx scripts/article-search-ui-test-server.mts',
    url: 'http://127.0.0.1:4183',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
