import assert from "node:assert/strict";
import test from "node:test";
import {
  anonymousImageVisible,
  formaWorkflow,
  makeFormaPackagePublic,
  redact,
  setPackagePublic,
} from "./make-forma-package-public.mjs";

test("the visibility call asks for public and hides the token", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({
      url: String(url),
      method: options.method,
      body: options.body,
    });
    return {
      ok: true,
      status: 200,
      json: async () => ({ visibility: "public" }),
    };
  };
  const result = await setPackagePublic({ token: "ghs_secret", fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(calls[0].method, "PATCH");
  assert.equal(JSON.parse(calls[0].body).visibility, "public");
  assert.equal(JSON.stringify(result).includes("ghs_secret"), false);
  assert.equal(redact("ghs_secret").includes("ghs_secret"), false);
});

test("a public registry token can see the pinned Forma tag", async () => {
  const payload = Buffer.from(
    JSON.stringify({
      access: [{ name: "awannaphasch2016/forma", actions: ["pull"] }],
    }),
  ).toString("base64url");
  const fetchImpl = async (url) => {
    if (String(url).includes("/token")) {
      return { ok: true, json: async () => ({ token: `h.${payload}.s` }) };
    }
    return { ok: true, status: 200 };
  };
  assert.equal(await anonymousImageVisible(fetchImpl), true);
});

test("the Forma workflow only changes visibility", () => {
  assert.equal(formaWorkflow.includes("packages: write"), true);
  assert.equal(formaWorkflow.includes('visibility: "public"'), true);
  assert.equal(formaWorkflow.includes("docker build"), false);
  assert.equal(formaWorkflow.includes("DOPPLER"), false);
});

test("the app path stops before pushing a Forma workflow", async () => {
  const calls = [];
  const payload = Buffer.from(
    JSON.stringify({
      access: [{ name: "awannaphasch2016/forma", actions: ["pull"] }],
    }),
  ).toString("base64url");
  const fetchImpl = async (url, options = {}) => {
    calls.push(String(url));
    if (options.method === "PATCH") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ visibility: "public" }),
      };
    }
    if (String(url).includes("ghcr.io/token")) {
      return { ok: true, json: async () => ({ token: `h.${payload}.s` }) };
    }
    if (String(url).includes("/manifests/")) return { ok: true, status: 200 };
    return { ok: false, status: 500, json: async () => ({}) };
  };
  const lines = [];
  const via = await makeFormaPackagePublic({
    token: "ghs_secret",
    fetchImpl,
    log: (line) => lines.push(line),
    pause: async () => {},
    attempts: 1,
  });
  assert.equal(via, "app");
  assert.equal(
    calls.some((url) => url.includes("/git/refs")),
    false,
  );
  assert.equal(lines.includes("forma_package=public via=app"), true);
});

