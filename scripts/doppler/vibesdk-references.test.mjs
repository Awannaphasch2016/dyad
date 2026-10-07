import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { redact } from "./vibesdk-project.mjs";
import {
  blockedReferenceNames,
  chooseReference,
  cloudflareProbes,
  probeResult,
  referenceResolved,
  takeSecretNames,
  vibesdkReferences,
} from "./vibesdk-references.mjs";

const copyScript = readFileSync(
  new URL("./copy-vibesdk-references.mjs", import.meta.url),
  "utf8",
);

test("references prefer dyad/dev and never select blocked secrets", () => {
  const namesByConfig = {
    prd: new Set([
      "CLOUDFLARE_API_TOKEN",
      "OPENROUTER_API_KEY",
      "NEON_API_KEY",
    ]),
    preview: new Set(["CLOUDFLARE_API_TOKEN_", "NEON_API_KEY"]),
    dev: new Set(["CLOUDFLARE_API_TOKEN", "OPENROUTER_API_KEY"]),
  };
  const cloudflare = chooseReference(vibesdkReferences[0], namesByConfig);
  assert.equal(cloudflare.config, "dev");
  assert.equal(cloudflare.source, "CLOUDFLARE_API_TOKEN");
  assert.equal(cloudflare.reference, "${dyad.dev.CLOUDFLARE_API_TOKEN}");
  const openRouter = chooseReference(vibesdkReferences[2], namesByConfig);
  assert.equal(openRouter.config, "dev");
  const neon = chooseReference(vibesdkReferences[3], namesByConfig);
  assert.equal(neon.config, "preview");
  assert.equal(neon.reference, "${dyad.preview.NEON_API_KEY}");
  assert.equal(
    vibesdkReferences.some((item) => blockedReferenceNames.includes(item.dest)),
    false,
  );
  assert.equal(
    vibesdkReferences.some((item) => item.dest === "GEMINI_API_KEY"),
    false,
  );
});

test("a missing dev config falls through to preview", () => {
  const choice = chooseReference(vibesdkReferences[0], {
    preview: new Set(["CLOUDFLARE_API_TOKEN_"]),
  });
  assert.equal(choice.config, "preview");
  assert.equal(choice.source, "CLOUDFLARE_API_TOKEN_");
  assert.equal(choice.reference, "${dyad.preview.CLOUDFLARE_API_TOKEN_}");
});

test("secret payloads are reduced to names", () => {
  const payload = {
    secrets: {
      OPENROUTER_API_KEY: { raw: "secret-value", computed: "secret-value" },
    },
  };
  assert.deepEqual(takeSecretNames(payload), ["OPENROUTER_API_KEY"]);
  assert.equal(payload.secrets.OPENROUTER_API_KEY.raw, undefined);
  assert.equal(payload.secrets.OPENROUTER_API_KEY.computed, undefined);
});

test("resolution and probe words do not include the secret", () => {
  assert.equal(referenceResolved(""), "absent");
  assert.equal(referenceResolved("${dyad.dev.NEON_API_KEY}"), "unresolved");
  assert.equal(referenceResolved("present"), "yes");
  assert.equal(probeResult(200), "allowed");
  assert.equal(probeResult(403), "denied");
  const urls = cloudflareProbes("account").map((probe) => probe[1]);
  assert.equal(
    urls.some((url) => url.includes("DELETE")),
    false,
  );
  assert.equal(urls[0].endsWith("/user/tokens/verify"), true);
  assert.equal(
    urls.some((url) => url.endsWith("/workers/scripts")),
    true,
  );
  assert.equal(
    urls.some((url) => url.endsWith("/d1/database")),
    true,
  );
});

test("the copy script does not print downloads or create resources", () => {
  assert.equal(copyScript.includes("WEWEBPLUS_DATABASE_URL"), false);
  assert.equal(copyScript.includes("GEMINI_API_KEY"), false);
  assert.equal(copyScript.includes("GOOGLE_AI_STUDIO_API_KEY"), false);
  assert.equal(copyScript.includes("connection_uri"), false);
  assert.equal(copyScript.includes("read_write"), false);
  assert.match(copyScript, /openrouter\/auto/);
  assert.match(redact("sk-or-secret napi_secret"), /sk-or-redacted/);
  assert.match(redact("sk-or-secret napi_secret"), /napi_redacted/);
});
