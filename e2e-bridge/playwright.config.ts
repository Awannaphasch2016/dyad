import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bridgeUrl = process.env.DYAD_BRIDGE_URL ?? "http://127.0.0.1:8372";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  timeout: 150 * 60 * 1000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  outputDir: path.join(root, "e2e-bridge/test-results"),
  reporter: [
    ["list"],
    [
      "html",
      {
        open: "never",
        outputFolder: path.join(root, "e2e-bridge/output/playwright-report"),
      },
    ],
  ],
  use: {
    baseURL: bridgeUrl,
    viewport: { width: 1280, height: 720 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: process.env.CI ? "xvfb-run -a npm start" : "npm start",
    cwd: root,
    url: bridgeUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 10 * 60 * 1000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
