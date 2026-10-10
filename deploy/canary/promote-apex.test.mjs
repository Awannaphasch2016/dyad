import assert from "node:assert/strict";
import test from "node:test";
import {
  apexDnsRecord,
  assertPromotionHostname,
  promoteApex,
  promotionIngress,
} from "./promote-apex.mjs";

const tunnelId = "a0591568-b3f5-46bf-9511-c1e5875b8446";

test("promotion ingress names the bare domain and keeps pre", () => {
  const ingress = promotionIngress();
  assert.deepEqual(
    ingress.config.ingress.map((rule) => rule.hostname ?? "404"),
    [
      "anakwannaphaschaiyong.com",
      "pre.anakwannaphaschaiyong.com",
      "*.anakwannaphaschaiyong.com",
      "404",
    ],
  );
  assert.equal(JSON.stringify(ingress).includes("www."), false);
  assert.equal(JSON.stringify(ingress).includes("6080"), false);
});

test("promotion refuses every name except the bare domain", () => {
  assert.throws(
    () => assertPromotionHostname("www.anakwannaphaschaiyong.com"),
    /apex/,
  );
  assert.throws(
    () => assertPromotionHostname("pre.anakwannaphaschaiyong.com"),
    /apex/,
  );
  assert.equal(apexDnsRecord(tunnelId).content, `${tunnelId}.cfargotunnel.com`);
});

test("promoteApex writes the bare domain onto the existing tunnel", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || "GET";
    calls.push(`${method} ${new URL(url).pathname}`);
    if (url.includes("/cfd_tunnel?") && method === "GET") {
      return json([{ id: tunnelId, name: "wewebplus-canary" }]);
    }
    if (url.includes("/dns_records?") && method === "GET") {
      return json([]);
    }
    return json({});
  };
  const result = await promoteApex({
    fetch: fetchImpl,
    accountId: "account",
    zoneId: "zone",
    apiToken: "token",
  });
  assert.equal(result.hostname, "anakwannaphaschaiyong.com");
  assert.equal(
    calls.some((call) => call.startsWith("PUT") && call.includes(tunnelId)),
    true,
  );
  assert.equal(
    calls.some((call) => call === "POST /client/v4/zones/zone/dns_records"),
    true,
  );
  assert.equal(
    calls.some((call) => call.includes("www")),
    false,
  );
});

function json(result) {
  return {
    ok: true,
    json: async () => ({ success: true, result }),
  };
}
