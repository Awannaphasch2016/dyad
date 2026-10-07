import assert from "node:assert/strict";
import test from "node:test";
import {
  canaryIdentityBody,
  matchingIdentity,
  secretsToCopy,
} from "./canary-identity.mjs";

test("the canary identity is an exact workflow subject", () => {
  const body = canaryIdentityBody();
  assert.equal(body.config.claims_type, "exact");
  assert.equal(Array.isArray(body.config.claims), false);
  const values = Object.values(body.config.claims).flat();
  assert.equal(
    values.some((value) => value.includes("*")),
    false,
  );
  assert.equal(
    values.some((value) => value.includes("canary-verify.yml")),
    true,
  );
  assert.equal(
    values.some((value) => value.endsWith("refs/heads/main")),
    false,
  );
});

test("an existing exact identity is reused", () => {
  const body = canaryIdentityBody();
  const found = matchingIdentity([
    { name: "other", config: { claims: body.config.claims } },
    { name: body.name, config: { claims: body.config.claims } },
  ]);
  assert.equal(found.name, body.name);
});

test("a wildcard identity is not a match", () => {
  const body = canaryIdentityBody();
  const found = matchingIdentity([
    {
      name: body.name,
      config: {
        claims: { sub: ["repo:Awannaphasch2016/dyad:*"] },
      },
    },
  ]);
  assert.equal(found, undefined);
});

test("preview names can be copied and the database URL cannot", () => {
  const copy = secretsToCopy(
    {
      CLOUDFLARE_API_TOKEN: "token",
      VERCEL_TOKEN: "vercel",
      WEWEBPLUS_DATABASE_URL: "postgres://production",
    },
    {},
  );
  assert.deepEqual(copy, {
    CLOUDFLARE_API_TOKEN: "token",
    VERCEL_TOKEN: "vercel",
  });
});
