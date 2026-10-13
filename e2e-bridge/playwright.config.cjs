const path = require("node:path");
const { defineConfig } = require("@playwright/test");

const root = path.resolve(__dirname, "..");
const bridgeUrl = process.env.DYAD_BRIDGE_URL ?? "http://127.0.0.1:8372";

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: /.*\.spec\.ts/,
  timeout: 180 * 1000,
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
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    trace: "retain-on-failure",
  },
  webServer: {
    command: process.env.CI ? "xvfb-run -a npm start" : "npm start",
    cwd: root,
    url: bridgeUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 75 * 1000,
    stdout: "pipe",
    stderr: "pipe",
    // npm start detaches Electron. SIGKILL of the xvfb-run group leaves that
    // process holding stdout, so Playwright waits on the pipe until the job
    // is killed. SIGTERM lets the supervisor stop Electron, then SIGKILL
    // follows if the shell is still up.
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
  },
});
