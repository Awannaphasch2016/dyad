import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { redact, verifyFormaAppAccess } from "./verify-forma-app-access.mjs";

test("the check redacts app tokens and only reports statuses", async () => {
  assert.equal(
    redact("token ghs_examplevalue leaked").includes("ghs_example"),
    false,
  );
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes("/repos/Awannaphasch2016/")) {
      if (String(url).includes("/contents/")) {
        return { ok: true, status: 200, json: async () => ({ size: 12 }) };
      }
      if (String(url).includes("/pulls")) {
        return { ok: true, status: 200, json: async () => [] };
      }
      const repo = String(url).split("/").pop();
      return {
        ok: true,
        status: 200,
        json: async () => ({ private: repo !== "forma" }),
      };
    }
    if (String(url).includes("ghcr.io/token")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ token: "registry-secret" }),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => "sha256:abc" },
      json: async () => ({}),
    };
  };
  const lines = await verifyFormaAppAccess({ token: "ghs_secret", fetchImpl });
  assert.equal(lines.includes("repo forma=ok private=false"), true);
  assert.equal(lines.includes("forma_contents=ok bytes=12"), true);
  assert.equal(lines.includes("forma_pulls=ok"), true);
  assert.equal(lines.includes("forma_packages=ok digest=sha256:abc"), true);
  assert.equal(JSON.stringify(lines).includes("ghs_secret"), false);
  assert.equal(JSON.stringify(lines).includes("registry-secret"), false);
  assert.equal(
    calls.some((url) => url.endsWith("/git/blobs")),
    false,
  );
});

test("a denied manifest reports the status and not the token", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("ghcr.io/token")) {
      return {
        ok: false,
        status: 403,
        json: async () => ({ token: "ghs_secret" }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ private: false, size: 1 }),
    };
  };
  await assert.rejects(
    () => verifyFormaAppAccess({ token: "ghs_secret", fetchImpl }),
    /forma_packages_token 403/,
  );
});

test("the workflow only reads after requesting the four grants", () => {
  const workflow = readFileSync(
    new URL("../workflows/verify-forma-app-access.yml", import.meta.url),
    "utf8",
  );
  for (const permission of [
    "permission-contents: write",
    "permission-packages: write",
    "permission-pull-requests: write",
    "permission-workflows: write",
  ]) {
    assert.equal(workflow.includes(permission), true);
  }
  assert.equal(workflow.includes("repositories: forma,bolt.diy,vibesdk"), true);
  assert.equal(workflow.includes("permission-actions:"), false);
  assert.equal(workflow.includes("git push"), false);
  assert.equal(workflow.includes("DOPPLER"), false);
});
