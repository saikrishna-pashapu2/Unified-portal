import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "article-ai.spec.ts",
  workers: 1,
  timeout: 45_000,
  use: {
    baseURL: "http://127.0.0.1:4182",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm exec tsx scripts/article-ai-ui-test-server.mts",
    url: "http://127.0.0.1:4182",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
