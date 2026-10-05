import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPreviewGasCityUrl,
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
