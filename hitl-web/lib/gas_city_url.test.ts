import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { GAS_CITY_PATHS } from "./gascity/contract.ts";
import {
  assertPreviewGasCityUrl,
  callGasCity,
  gasCityRunsUrl,
  postPreviewPrompt,
} from "./gas_city_url.ts";

test("a preview build requires NEXT_PUBLIC_GAS_CITY_URL", () => {
  assert.throws(
    () => assertPreviewGasCityUrl({ VERCEL_ENV: "preview" }),
    /NEXT_PUBLIC_GAS_CITY_URL is required/,
  );
  assert.doesNotThrow(() =>
    assertPreviewGasCityUrl({
      VERCEL_ENV: "preview",
      NEXT_PUBLIC_GAS_CITY_URL: "https://gc-pr-20.anakwannaphaschaiyong.com",
    }),
  );
  assert.doesNotThrow(() =>
    assertPreviewGasCityUrl({ VERCEL_ENV: "production" }),
  );
  assert.doesNotThrow(() => assertPreviewGasCityUrl({}));
});

test("an empty Gas City URL throws before fetch and never calls /v1 on this page", async () => {
  let called = false;
  const fetchImpl: typeof fetch = async () => {
    called = true;
    throw new Error("fetch should not run");
  };
  await assert.rejects(
    () =>
      postPreviewPrompt(
        { prompt: "build the board", idempotencyKey: "k1", token: "session" },
        fetchImpl,
        {},
      ),
    /preview listener is not configured/,
  );
  assert.equal(called, false);
  assert.throws(
    () => gasCityRunsUrl({ NEXT_PUBLIC_GAS_CITY_URL: "/v1/runs" }),
    /preview listener is not configured/,
  );
});

test("an empty Gas City URL throws before fetch for a prompt, a question list, an answer, and a runtime capability", async () => {
  let called = false;
  const fetchImpl: typeof fetch = async () => {
    called = true;
    throw new Error("fetch should not run");
  };
  const paths = [
    GAS_CITY_PATHS.runs,
    GAS_CITY_PATHS.questions,
    GAS_CITY_PATHS.answer("question-1"),
    GAS_CITY_PATHS.electronCapability,
  ];
  for (const requestPath of paths) {
    await assert.rejects(
      () => callGasCity(requestPath, { method: "POST" }, fetchImpl, {}),
      /preview listener is not configured/,
    );
  }
  await assert.rejects(
    () =>
      postPreviewPrompt(
        { prompt: "build the board", idempotencyKey: "k1", token: "session" },
        fetchImpl,
        {},
      ),
    /preview listener is not configured/,
  );
  await assert.rejects(
    () =>
      callGasCity(GAS_CITY_PATHS.questions, undefined, fetchImpl, {
        NEXT_PUBLIC_GAS_CITY_URL: "/v1/hitl/questions",
      }),
    /preview listener is not configured/,
  );
  await assert.rejects(
    () =>
      callGasCity(GAS_CITY_PATHS.electronCapability, undefined, fetchImpl, {
        NEXT_PUBLIC_GAS_CITY_URL: "http://gc-pr-20.anakwannaphaschaiyong.com",
      }),
    /preview listener is not configured/,
  );
  assert.equal(called, false);
});

test("this app does not serve /v1/runs and next.config has no /v1 rewrite", () => {
  const hitlWeb = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  assert.equal(
    existsSync(path.join(hitlWeb, "app/api/v1/runs/route.ts")),
    false,
  );
  assert.equal(
    existsSync(path.join(hitlWeb, "app/api/v1/hitl/questions/route.ts")),
    false,
  );
  assert.equal(
    existsSync(
      path.join(hitlWeb, "app/api/v1/hitl/questions/[id]/answers/route.ts"),
    ),
    false,
  );
  assert.equal(
    existsSync(path.join(hitlWeb, "app/api/v1/capabilities/electron/route.ts")),
    false,
  );
  const config = readFileSync(path.join(hitlWeb, "next.config.ts"), "utf8");
  assert.equal(config.includes("/api/v1"), false);
  assert.equal(config.includes('"/v1'), false);
  assert.match(config, /assertPreviewGasCityUrl\(\)/);
  const client = readFileSync(
    path.join(hitlWeb, "lib/gascity/browser_client.ts"),
    "utf8",
  );
  assert.equal(client.includes("same-origin"), false);
  assert.match(client, /callGasCity\(/);
});

test("a prompt is posted only to the absolute Gas City listener", async () => {
  const calls: Array<{ url: string; authorization: string }> = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(url),
      authorization: headers.get("authorization") ?? "",
    });
    return new Response(JSON.stringify({ status: "accepted" }), {
      status: 202,
    });
  };
  const response = await postPreviewPrompt(
    { prompt: "build the board", idempotencyKey: "k1", token: "session" },
    fetchImpl,
    {
      NEXT_PUBLIC_GAS_CITY_URL: "https://gc-pr-20.anakwannaphaschaiyong.com/",
    },
  );
  assert.equal(response.status, 202);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://gc-pr-20.anakwannaphaschaiyong.com/v1/runs",
  );
  assert.equal(calls[0].authorization, "Bearer session");
  assert.equal(calls[0].url.startsWith("/"), false);
});
