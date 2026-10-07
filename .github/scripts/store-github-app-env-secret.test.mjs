import crypto from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import {
  createAppJwt,
  installationApprovalUrl,
  resolveAppId,
  storeGithubAppEnvSecret,
} from "./store-github-app-env-secret.mjs";

test("resolveAppId falls back to the dyad-harness app id", () => {
  assert.equal(resolveAppId(""), "5221649");
  assert.equal(resolveAppId("  42  "), "42");
});

test("createAppJwt is a signed RS256 token for the app id", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  const jwt = createAppJwt(pem, "5221649", 1_700_000_000);
  const [header, payload, signature] = jwt.split(".");
  const unsigned = `${header}.${payload}`;
  const valid = crypto
    .createVerify("RSA-SHA256")
    .update(unsigned)
    .verify(publicKey, signature, "base64url");
  assert.equal(valid, true);
  assert.equal(
    JSON.parse(Buffer.from(payload, "base64url").toString()).iss,
    "5221649",
  );
});

test("installationApprovalUrl points at the installation settings page", () => {
  assert.equal(
    installationApprovalUrl(99),
    "https://github.com/settings/installations/99",
  );
});

test("storeGithubAppEnvSecret writes both secret names and the app id", async () => {
  const pem =
    "-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----";
  const createJwt = () => "jwt";
  const githubRequest = async (url) => {
    if (url.endsWith("/installation")) {
      return { id: 77, permissions: { environments: "write" } };
    }
    if (url.endsWith("/access_tokens")) return { token: "ghs_test" };
    throw new Error(`unexpected ${url}`);
  };
  const secrets = [];
  await storeGithubAppEnvSecret({
    pem,
    appId: "5221649",
    repository: "Awannaphasch2016/dyad",
    createJwt,
    githubRequest,
    setSecret: async ({ name, value }) => {
      secrets.push({ name, value });
    },
    upsertVariable: async ({ name, value }) => {
      secrets.push({ name, value });
    },
  });
  assert.deepEqual(
    secrets.map((entry) => entry.name),
    [
      "DYAD_GITHUB_APP_SECRET_KEY",
      "DYAD_GITHUB_APP_PRIVATE_KEY",
      "DYAD_GITHUB_APP_ID",
    ],
  );
  assert.equal(secrets[0].value, pem);
});

test("storeGithubAppEnvSecret stops when the installation has not accepted Environments write", async () => {
  const pem =
    "-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----";
  await assert.rejects(
    () =>
      storeGithubAppEnvSecret({
        pem,
        appId: "5221649",
        repository: "Awannaphasch2016/dyad",
        createJwt: () => "jwt",
        githubRequest: async (url) => {
          if (url.endsWith("/installation")) return { id: 77, permissions: {} };
          throw new Error(`unexpected ${url}`);
        },
        setSecret: async () => {
          throw new Error("secret should not be written");
        },
      }),
    /settings\/apps\/dyad-harness\/permissions/,
  );
});
