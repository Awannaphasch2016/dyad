import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync(
  new URL("./gascity-entrypoint.sh", import.meta.url),
  "utf8",
);

test("the canary hostname root opens the desktop instead of a file list", () => {
  const webRoot = entrypoint.indexOf('novnc_root="/tmp/novnc-web"');
  const index = entrypoint.indexOf('content="0;url=vnc.html"');
  const serve = entrypoint.indexOf('--web="$novnc_root"');
  assert.ok(webRoot !== -1);
  assert.ok(index !== -1);
  assert.ok(serve !== -1);
  assert.ok(webRoot < index && index < serve);
  assert.equal(entrypoint.includes("--web=/usr/share/novnc/"), false);
});
