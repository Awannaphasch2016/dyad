import assert from "node:assert/strict";
import test from "node:test";
import {
  FORMULA_HOSTNAME,
  FORMULA_PREVIEW_URL,
  cloudflareFromMaps,
  cloudflarePresence,
  ensureFormulaDns,
  formulaAliasRecord,
  formulaValidationRecord,
} from "./formula_dns.mjs";

const loadBalancerDns = "formula-preview-1.ap-southeast-1.elb.amazonaws.com";

test("the public formula name is HTTPS on the existing zone", () => {
  assert.equal(FORMULA_HOSTNAME, "formula.anakwannaphaschaiyong.com");
  assert.equal(FORMULA_PREVIEW_URL, "https://formula.anakwannaphaschaiyong.com");
  assert.deepEqual(formulaAliasRecord(loadBalancerDns), {
    type: "CNAME",
    name: FORMULA_HOSTNAME,
    content: loadBalancerDns,
    proxied: true,
    ttl: 1,
  });
  assert.throws(
    () => formulaAliasRecord("formula-preview-1.us-east-1.elb.amazonaws.com"),
    /ap-southeast-1/,
  );
});

test("validation stays under the formula name and off the tunnel names", () => {
  assert.deepEqual(
    formulaValidationRecord(
      "_abc.formula.anakwannaphaschaiyong.com.",
      "_abc.acm-validations.aws.",
    ),
    {
      type: "CNAME",
      name: "_abc.formula.anakwannaphaschaiyong.com",
      content: "_abc.acm-validations.aws",
      proxied: false,
      ttl: 1,
    },
  );
  assert.throws(
    () =>
      formulaValidationRecord(
        "pr-79.anakwannaphaschaiyong.com",
        "_abc.acm-validations.aws",
      ),
    /tunnel/,
  );
  assert.throws(
    () =>
      formulaValidationRecord(
        "other.example.com",
        "_abc.acm-validations.aws",
      ),
    /formula hostname/,
  );
});

test("Cloudflare values come from the environment or Doppler and are not printed", () => {
  const creds = cloudflareFromMaps(
    { CLOUDFLARE_API_TOKEN: " from-env " },
    [
      {
        CLOUDFLARE_API_TOKEN: "from-doppler",
        CLOUDFLARE_ZONE_ID: "zone",
        CLOUDFLARE_ACCOUNT_ID: "account",
      },
    ],
  );
  assert.equal(creds.token, "from-env");
  assert.equal(creds.zoneId, "zone");
  assert.equal(creds.accountId, "account");
  const presence = cloudflarePresence(creds);
  assert.match(presence, /CLOUDFLARE_API_TOKEN: present/);
  assert.equal(presence.includes("from-env"), false);
  assert.equal(presence.includes("from-doppler"), false);
});

test("DNS setup writes the alias and the validation name, not a tunnel", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? "GET", body: init.body ?? "" });
    const path = `${new URL(url).pathname}${new URL(url).search}`;
    if (path.includes("/dns_records") && (init.method ?? "GET") === "GET") {
      return { ok: true, json: async () => ({ success: true, result: [] }) };
    }
    if (path.endsWith("/dns_records") && init.method === "POST") {
      return {
        ok: true,
        json: async () => ({ success: true, result: { id: "dns" } }),
      };
    }
    throw new Error(`unexpected ${path}`);
  };
  const result = await ensureFormulaDns({
    fetch: fetchImpl,
    token: "secret-token",
    zoneId: "zone",
    accountId: "account",
    loadBalancerDns,
    validationName: "_abc.formula.anakwannaphaschaiyong.com.",
    validationValue: "_abc.acm-validations.aws.",
  });
  assert.deepEqual(result, { hostname: FORMULA_HOSTNAME });
  assert.equal(result.token, undefined);
  const bodies = calls.map((call) => String(call.body));
  assert.equal(
    bodies.some((body) => body.includes(FORMULA_HOSTNAME) && body.includes('"proxied":true')),
    true,
  );
  assert.equal(
    bodies.some((body) => body.includes("_abc.formula") && body.includes('"proxied":false')),
    true,
  );
  assert.equal(bodies.some((body) => body.includes("pr-79")), false);
  assert.equal(bodies.some((body) => body.includes("cfargotunnel")), false);
  assert.equal(
    calls.some((call) => call.url.includes("secret-token")),
    false,
  );
});

test("missing Cloudflare names stop before a request", async () => {
  let called = false;
  await assert.rejects(
    () =>
      ensureFormulaDns({
        fetch: async () => {
          called = true;
          return { ok: true, json: async () => ({ success: true, result: [] }) };
        },
        token: "",
        zoneId: "zone",
        accountId: "account",
        loadBalancerDns,
      }),
    /CLOUDFLARE_API_TOKEN/,
  );
  assert.equal(called, false);
});
