import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  publishWorkflow,
  redact,
  republishFormaImage,
  workflowNeedsOwnerLogin,
} from "./republish-forma-image.mjs";

test("owner login workflow does not use the app actor", () => {
  assert.equal(workflowNeedsOwnerLogin("username: ${{ github.actor }}"), true);
  assert.equal(
    workflowNeedsOwnerLogin(publishWorkflow.replaceAll("\\${", "${")),
    false,
  );
  assert.equal(publishWorkflow.includes("github.actor"), false);
  assert.equal(publishWorkflow.includes("DOPPLER"), false);
  assert.equal(publishWorkflow.includes("permission-actions"), false);
  assert.equal(publishWorkflow.includes('visibility: "public"'), true);
});

test("republish replaces the actor login and hides the token", async () => {
  const calls = [];
  const fileSha = "cccccccccccccccccccccccccccccccccccccccc";
  const commit = "dddddddddddddddddddddddddddddddddddddddd";
  const fetchImpl = async (url, options = {}) => {
    calls.push({
      url: String(url),
      method: options.method,
      body: options.body,
    });
    if (!options.method) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          sha: fileSha,
          content: Buffer.from(
            "username: ${{ github.actor }}\n",
            "utf8",
          ).toString("base64"),
        }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ commit: { sha: commit } }),
    };
  };
  const result = await republishFormaImage({
    token: "ghs_secret",
    fetchImpl,
  });
  assert.deepEqual(result, { updated: true, sha: commit });
  const put = JSON.parse(calls.find((call) => call.method === "PUT").body);
  const written = Buffer.from(put.content, "base64").toString("utf8");
  assert.equal(put.sha, fileSha);
  assert.equal(put.branch, "cursor/forma-preview-walkthrough");
  assert.equal(written.includes("github.actor"), false);
  assert.equal(
    written.includes("username: ${{ github.repository_owner }}"),
    true,
  );
  assert.equal(JSON.stringify(result).includes("ghs_secret"), false);
  assert.equal(redact("Bearer ghs_secret").includes("ghs_secret"), false);
});

test("republish leaves an owner-login workflow unchanged", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push(options.method ?? "GET");
    return {
      ok: true,
      status: 200,
      json: async () => ({
        sha: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        content: Buffer.from(publishWorkflow, "utf8").toString("base64"),
      }),
    };
  };
  const result = await republishFormaImage({ token: "ghs_secret", fetchImpl });
  assert.equal(result.updated, false);
  assert.equal(calls.includes("PUT"), false);
});

test("the dyad workflow only asks Forma for content write", () => {
  const workflow = readFileSync(
    new URL("../workflows/republish-forma-image.yml", import.meta.url),
    "utf8",
  );
  assert.equal(workflow.includes("repositories: forma"), true);
  assert.equal(workflow.includes("permission-contents: write"), true);
  assert.equal(workflow.includes("permission-actions:"), false);
  assert.equal(workflow.includes("permission-packages:"), false);
  assert.equal(workflow.includes("DOPPLER"), false);
});
