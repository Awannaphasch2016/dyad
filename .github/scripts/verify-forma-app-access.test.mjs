import assert from "node:assert/strict";
import test from "node:test";
import {
  redact,
  registryAccess,
  verifyFormaAppAccess,
} from "./verify-forma-app-access.mjs";

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
  assert.equal(
    lines.includes("forma_packages=ok auth=bearer digest=sha256:abc"),
    true,
  );
  assert.equal(JSON.stringify(lines).includes("ghs_secret"), false);
  assert.equal(JSON.stringify(lines).includes("registry-secret"), false);
  assert.equal(
    calls.some((url) => url.endsWith("/git/blobs")),
    false,
  );
});

test("a denied manifest reports statuses and not the token", async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    const href = String(url);
    if (href.includes("/v2/")) {
      return { ok: false, status: 401, headers: { get: () => null } };
    }
    if (href.includes("ghcr.io/token")) {
      return { ok: false, status: 403, json: async () => ({}) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ private: false, size: 1 }),
    };
  };
  await assert.rejects(
    () =>
      verifyFormaAppAccess({
        token: "ghs_secret",
        fetchImpl,
        log: (line) => seen.push(line),
      }),
    (error) => {
      assert.match(error.message, /forma_packages=denied bearer=401 basic=401/);
      assert.equal(error.message.includes("ghs_secret"), false);
      return true;
    },
  );
  assert.equal(seen.includes("forma_pulls=ok"), true);
});

test("registry access logs the pull scope and not the token", () => {
  const payload = Buffer.from(
    JSON.stringify({
      access: [
        {
          type: "repository",
          name: "awannaphasch2016/forma",
          actions: ["pull"],
        },
      ],
    }),
  ).toString("base64url");
  const token = `header.${payload}.signature-secret`;
  assert.equal(registryAccess(token), "awannaphasch2016/forma:pull");
  assert.equal(registryAccess("not-a-jwt"), "none");
});
