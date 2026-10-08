import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { redact, republishFormaImage } from "./republish-forma-image.mjs";

test("republish keeps the same tree and hides the token", async () => {
  const parent = "80a8e419f6285378b4dfada336ea8213f3089bab";
  const tree = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const next = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({
      url: String(url),
      method: options.method,
      body: options.body,
    });
    if (
      String(url).endsWith("/git/ref/heads/cursor/forma-preview-walkthrough")
    ) {
      return { ok: true, json: async () => ({ object: { sha: parent } }) };
    }
    if (String(url).endsWith(`/git/commits/${parent}`)) {
      return { ok: true, json: async () => ({ tree: { sha: tree } }) };
    }
    if (options.method === "POST") {
      return { ok: true, json: async () => ({ sha: next }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const result = await republishFormaImage({
    token: "ghs_secret",
    fetchImpl,
  });
  assert.deepEqual(result, { parent, sha: next });
  const created = JSON.parse(calls.find((call) => call.method === "POST").body);
  assert.equal(created.tree, tree);
  assert.deepEqual(created.parents, [parent]);
  assert.equal(JSON.stringify(result).includes("ghs_secret"), false);
  assert.equal(redact("ghs_secret").includes("ghs_secret"), false);
});

test("the workflow only asks Forma for content write", () => {
  const workflow = readFileSync(
    new URL("../workflows/republish-forma-image.yml", import.meta.url),
    "utf8",
  );
  assert.equal(workflow.includes("repositories: forma"), true);
  assert.equal(workflow.includes("permission-contents: write"), true);
  assert.equal(workflow.includes("permission-actions:"), false);
  assert.equal(workflow.includes("DOPPLER"), false);
});
