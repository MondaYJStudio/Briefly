import { defineConfig } from "playwright/test";

import { playwrightBaseUrl } from "./playwright/runtime";

export default defineConfig({
  testDir: "./playwright",
  testMatch: [
    "critical-journey.spec.ts",
    "settings-account-drawers.spec.ts",
    "reference-acceptance.spec.ts",
  ],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: playwrightBaseUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "pnpm test:e2e:server",
    url: `${playwrightBaseUrl}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
