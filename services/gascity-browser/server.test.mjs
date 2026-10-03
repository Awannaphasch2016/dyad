import assert from "node:assert/strict";
import test from "node:test";
import { createGasCityBrowserServer } from "./server.mjs";

async function withServer(options, run) {
  const server = createGasCityBrowserServer(options);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    await run(base);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

const auth = { authorization: "Bearer session-token" };

test("a prompt is accepted without invoking Electron", async () => {
  let called = false;
  await withServer({ invokeElectron: () => { called = true; } }, async (base) => {
    const response = await fetch(`${base}/v1/runs`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ prompt: "a one-page site", idempotencyKey: "k1" }),
    });
    const body = await response.json();
    assert.equal(response.status, 202);
    assert.equal(body.orchestration, "gascity");
    assert.equal(body.electronInvoked, false);
    assert.match(body.runId, /^gascity-run:/);
    assert.equal(called, false);
  });
});

test("an electron capability stays uninvoked until GasCity supplies a bridge", async () => {
  await withServer({}, async (base) => {
    const response = await fetch(`${base}/v1/capabilities/electron`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ capability: "terminal", reason: "open a shell" }),
    });
    const body = await response.json();
    assert.equal(response.status, 409);
    assert.equal(body.disposition, "electron-required");
    assert.equal(body.electronInvoked, false);
  });
});

test("a configured bridge is the only path that invokes Electron", async () => {
  const seen = [];
  await withServer(
    { invokeElectron: async (capability) => seen.push(capability) },
    async (base) => {
      const response = await fetch(`${base}/v1/capabilities/electron`, {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ capability: "preview", reason: "show the app" }),
      });
      const body = await response.json();
      assert.equal(response.status, 409);
      assert.equal(body.electronInvoked, true);
      assert.deepEqual(seen, ["preview"]);
    },
  );
});

test("a browser origin that is not listed is refused", async () => {
  await withServer({ origins: ["https://dyad.example"] }, async (base) => {
    const response = await fetch(`${base}/v1/runs`, {
      method: "POST",
      headers: {
        ...auth,
        origin: "https://other.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ prompt: "hi", idempotencyKey: "k1" }),
    });
    assert.equal(response.status, 403);
  });
});

test("a listed browser origin can post a run", async () => {
  await withServer({ origins: ["https://dyad.example"] }, async (base) => {
    const response = await fetch(`${base}/v1/runs`, {
      method: "POST",
      headers: {
        ...auth,
        origin: "https://dyad.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ prompt: "hi", idempotencyKey: "k1" }),
    });
    assert.equal(response.status, 202);
    assert.equal(response.headers.get("access-control-allow-origin"), "https://dyad.example");
  });
});

test("a missing session is rejected and HITL without a store is unavailable", async () => {
  await withServer({}, async (base) => {
    const signedOut = await fetch(`${base}/v1/runs`, { method: "POST" });
    assert.equal(signedOut.status, 401);
    const questions = await fetch(`${base}/v1/hitl/questions`, { headers: auth });
    assert.equal(questions.status, 503);
  });
});
