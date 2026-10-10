import { defineConfig, devices } from "@playwright/test";

// Desktop Chrome is the agreed verification browser. One worker: the two
// roles share one project on the preview, so tests must not interleave.
export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.ts",
  outputDir: "./test-results",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 10 * 60 * 1000,
  expect: { timeout: 30 * 1000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: "./playwright-report", open: "never" }],
    ["json", { outputFile: "./report/playwright.json" }],
  ],
  use: {
    ...devices["Desktop Chrome"],
    baseURL:
      process.env.WALKTHROUGH_URL ??
      "https://bolt-walkthrough-55d6.karant-test-egress-canary.workers.dev",
    // Traces record request headers. Each test signs out at the end, so a
    // leaked trace holds a dead session, but keep them for failures only.
    trace: "retain-on-failure",
    video: "on",
    screenshot: "off",
    actionTimeout: 30 * 1000,
    navigationTimeout: 60 * 1000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
