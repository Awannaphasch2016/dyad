import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCanaryDownload,
  loadCanarySecrets,
} from "./load-canary-secrets.mjs";

test("canary secrets are stored by name and production is not requested", async () => {
  const calls = [];
  const stored = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    assert.equal(String(url).includes("config=prd"), false);
    assert.equal(String(url).includes("config=canary"), true);
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          AWS_REGION: "ap-southeast-1",
          WEWEBPLUS_DATABASE_URL:
            "postgresql://role:secret@ep-bold-sky.example/neondb",
          ignored: 1,
        }),
    };
  };
  const names = await loadCanarySecrets({
    token: "dp.st.admin-token",
    fetchImpl,
    writeEnv: (name, value) => stored.push([name, value]),
  });
  assert.deepEqual(names, ["AWS_REGION", "WEWEBPLUS_DATABASE_URL"]);
  assert.equal(stored[1][1].includes("secret"), true);
  assert.equal(JSON.stringify(names).includes("secret"), false);
  assert.equal(calls.length, 1);
});

test("a production config download is refused", () => {
  assert.throws(
    () =>
      assertCanaryDownload(
        "https://api.doppler.com/v3/configs/config/secrets/download?project=dyad&config=prd&format=json",
      ),
    /canary/,
  );
});
