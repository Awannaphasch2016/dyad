import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  credentialShape,
  fingerprint,
  publicCloudflareError,
  tunnelMetadata,
} from "./compare_cloudflare_credentials.mjs";

test("fingerprints match only when the credential text matches", () => {
  const left = fingerprint("same-token");
  const right = fingerprint("same-token");
  const other = fingerprint("other-token");
  assert.equal(left.sha256_12, right.sha256_12);
  assert.notEqual(left.sha256_12, other.sha256_12);
  assert.equal(
    left.sha256_12,
    createHash("sha256").update("same-token").digest("hex").slice(0, 12),
  );
  assert.equal(fingerprint("  "), null);
});

test("a tunnel credential is recognized without exposing its secret", () => {
  const encoded = Buffer.from(
    JSON.stringify({ a: "account", t: "tunnel-id", s: "tunnel-secret" }),
  ).toString("base64");
  assert.equal(credentialShape(encoded), "tunnel-credential");
  assert.deepEqual(tunnelMetadata(encoded), {
    tunnelId: "tunnel-id",
    accountPresent: true,
    secretPresent: true,
  });
  assert.equal(credentialShape("plain-api-token"), "other");
  assert.equal(
    credentialShape("${dyad.preview.CLOUDFLARE_API_TOKEN}"),
    "unresolved",
  );
});

test("cloudflare errors keep the code and message only", () => {
  assert.equal(
    publicCloudflareError({
      errors: [{ code: 10000, message: "Authentication error" }],
    }),
    "10000:Authentication error",
  );
  assert.equal(publicCloudflareError({}), "none");
});
