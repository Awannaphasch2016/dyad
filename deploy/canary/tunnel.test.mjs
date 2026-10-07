import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCanaryHostname,
  canaryDnsRecord,
  canaryIngress,
} from "./tunnel.mjs";

test("the canary tunnel serves noVNC on the pre hostname", () => {
  const ingress = canaryIngress();
  assert.equal(
    ingress.config.ingress[0].hostname,
    "pre.anakwannaphaschaiyong.com",
  );
  assert.equal(ingress.config.ingress[0].service, "http://127.0.0.1:6080");
  assert.equal(JSON.stringify(ingress).includes("8787"), false);
});

test("the apex cannot be the canary record", () => {
  assert.throws(
    () => assertCanaryHostname("anakwannaphaschaiyong.com"),
    /canary/,
  );
  const record = canaryDnsRecord("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  assert.equal(record.name, "pre.anakwannaphaschaiyong.com");
});
