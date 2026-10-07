import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCanaryHostname,
  canaryDnsRecord,
  canaryIngress,
  ensureCanaryTunnel,
} from "./tunnel.mjs";

test("the canary tunnel serves the Dyad page on the pre hostname", () => {
  const ingress = canaryIngress();
  assert.equal(
    ingress.config.ingress[0].hostname,
    "pre.anakwannaphaschaiyong.com",
  );
  assert.equal(ingress.config.ingress[0].service, "http://127.0.0.1:8373");
  assert.equal(JSON.stringify(ingress).includes("6080"), false);
  assert.equal(JSON.stringify(ingress).includes("8787"), false);
});

test("the canary tunnel writes only the pre hostname", async () => {
  const calls = [];
  let written = "";
  const fetchImpl = async (url, init = {}) => {
    calls.push(`${init.method || "GET"} ${url}`);
    const path = new URL(url).pathname;
    if (path.endsWith("/cfd_tunnel") && (init.method || "GET") === "GET") {
      return json({ success: true, result: [] });
    }
    if (path.endsWith("/cfd_tunnel") && init.method === "POST") {
      return json({
        success: true,
        result: {
          id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          name: "wewebplus-canary",
        },
      });
    }
    if (path.endsWith("/token")) {
      return json({ success: true, result: "tunnel-token" });
    }
    if (path.endsWith("/configurations")) {
      const body = JSON.parse(init.body);
      assert.equal(
        body.config.ingress[0].hostname,
        "pre.anakwannaphaschaiyong.com",
      );
      return json({ success: true, result: {} });
    }
    if (path.endsWith("/dns_records") && (init.method || "GET") === "GET") {
      return json({ success: true, result: [] });
    }
    if (path.endsWith("/dns_records") && init.method === "POST") {
      const body = JSON.parse(init.body);
      assert.equal(body.name, "pre.anakwannaphaschaiyong.com");
      return json({ success: true, result: { id: "record" } });
    }
    throw new Error(`unexpected ${url}`);
  };
  const result = await ensureCanaryTunnel({
    fetch: fetchImpl,
    accountId: "account",
    zoneId: "zone",
    apiToken: "token",
    writeToken: async (token) => {
      written = token;
    },
  });
  assert.equal(result.hostname, "pre.anakwannaphaschaiyong.com");
  assert.equal(written, "tunnel-token");
  assert.equal(
    calls.some((call) => call.includes("anakwannaphaschaiyong.com/dns")),
    false,
  );
});

function json(body) {
  return { ok: true, statusText: "OK", json: async () => body };
}

test("the apex cannot be the canary record", () => {
  assert.throws(
    () => assertCanaryHostname("anakwannaphaschaiyong.com"),
    /canary/,
  );
  const record = canaryDnsRecord("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  assert.equal(record.name, "pre.anakwannaphaschaiyong.com");
});
