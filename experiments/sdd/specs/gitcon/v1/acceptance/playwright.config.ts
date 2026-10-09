import { defineConfig } from "@playwright/test";

// BASE_URL points at the running implementation container.
// EVIDENCE_DIR receives screenshots, the JSON report and the HTML report.
const evidence = process.env.EVIDENCE_DIR ?? "evidence";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    ["list"],
    ["json", { outputFile: `${evidence}/playwright.json` }],
    ["html", { outputFolder: `${evidence}/playwright-report`, open: "never" }],
  ],
  outputDir: `${evidence}/test-results`,
  use: {
    baseURL: process.env.BASE_URL ?? "http://127.0.0.1:8080",
    trace: "on",
    video: "on",
    screenshot: "on",
    viewport: { width: 1280, height: 800 },
  },
});
