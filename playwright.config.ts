import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: false,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3200",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "corepack pnpm exec tsx server/_core/index.ts",
    url: "http://127.0.0.1:3200",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      AUTH_PROVIDER: "local-dev",
      VITE_AUTH_PROVIDER: "local-dev",
      NODE_ENV: "development",
      PORT: "3200",
      APP_BASE_URL: "http://127.0.0.1:3200",
      ANALYSIS_ENGINE: "mock",
      ANALYSIS_WORKER_MODE: "external",
    },
  },
});
