import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  ELECTRON_CAPABILITIES,
  IPC_DOMAINS,
  domainsFor,
  electronCapabilityFor,
  isElectronCapability,
  runtimeOwner,
} from "./boundary.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("every IPC domain has one owner", () => {
  const seen = new Set<string>();
  for (const domain of IPC_DOMAINS) {
    assert.equal(seen.has(domain), false);
    seen.add(domain);
    const owner = runtimeOwner(domain);
    assert.ok(
      owner === "browser" || owner === "gascity" || owner === "electron",
    );
  }
  assert.deepEqual(
    [
      ...domainsFor("browser"),
      ...domainsFor("gascity"),
      ...domainsFor("electron"),
    ].sort(),
    [...IPC_DOMAINS].sort(),
  );
});

test("clerk stays in the browser and chat goes to GasCity", () => {
  assert.equal(runtimeOwner("clerk"), "browser");
  assert.equal(runtimeOwner("chat"), "gascity");
  assert.equal(runtimeOwner("factory"), "gascity");
  assert.equal(runtimeOwner("factoryHost"), "gascity");
  assert.equal(runtimeOwner("terminal"), "electron");
  assert.equal(runtimeOwner("previewView"), "electron");
  assert.equal(electronCapabilityFor("terminal"), "terminal");
  assert.equal(electronCapabilityFor("chat"), null);
});

test("electron capabilities are a closed set", () => {
  for (const capability of ELECTRON_CAPABILITIES) {
    assert.equal(isElectronCapability(capability), true);
  }
  assert.equal(isElectronCapability("chat"), false);
  assert.equal(isElectronCapability(""), false);
});

test("the web app does not import Electron", () => {
  const files = sourceFiles(root);
  assert.ok(files.length > 10);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    assert.equal(text.includes('from "electron"'), false, file);
    assert.equal(text.includes("window.electron"), false, file);
    assert.equal(text.includes("ipcRenderer"), false, file);
  }
});

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = path.join(directory, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      found.push(...sourceFiles(full));
      continue;
    }
    if (/\.test\.(ts|tsx)$/.test(entry)) continue;
    if (/\.(ts|tsx|js|mjs)$/.test(entry)) found.push(full);
  }
  return found;
}
