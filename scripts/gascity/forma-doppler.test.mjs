import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { selectFormaDevSecrets, formaSecretNames } from "./forma-doppler.mjs";

const workflow = readFileSync(
  new URL("../../.github/workflows/forma-doppler-setup.yml", import.meta.url),
  "utf8",
);
const script = readFileSync(
  new URL("./forma-doppler.mjs", import.meta.url),
  "utf8",
);

test("forma dev secrets skip production data", () => {
  const { copied, report } = selectFormaDevSecrets({
    NOVNC_PASSWORD: "novnc-example",
    CLERK_SECRET_KEY: "sk-example",
    NEON_API_KEY: "neon-example",
    NEON_PARENT_BRANCH_ID: "br-mute-shadow-b3jxqoho",
    WEWEBPLUS_DATABASE_URL:
      "postgresql://example:example@ep-young-wave-b3cwe0rz-pooler.example/db",
    AWS_ACCESS_KEY_ID: "aws-example",
    AWS_SECRET_ACCESS_KEY: "aws-secret-example",
    DOPPLER_PROJECT: "dyad",
    UNRELATED_TOKEN: "do-not-copy",
  });
  assert.deepEqual(Object.keys(copied).sort(), [
    "CLERK_SECRET_KEY",
    "NEON_API_KEY",
    "NOVNC_PASSWORD",
  ]);
  assert.equal(copied.WEWEBPLUS_DATABASE_URL, undefined);
  assert.equal(copied.AWS_ACCESS_KEY_ID, undefined);
  assert.equal(copied.NEON_PARENT_BRANCH_ID, undefined);
  assert.equal(report.database, "excluded_production");
  assert.equal(report.databaseHost, "ep-young-wave-b3cwe0rz-pooler");
  assert.equal(report.neonParent, "excluded");
  assert.equal(copied.UNRELATED_TOKEN, undefined);
});

test("a non-production database url is copied with its host label", () => {
  const url = "postgresql://example:example@ep-other-host.example/neondb";
  const { copied, report } = selectFormaDevSecrets({
    WEWEBPLUS_DATABASE_URL: url,
    NEON_PARENT_BRANCH_ID: "br-sanitized-parent",
  });
  assert.equal(copied.WEWEBPLUS_DATABASE_URL, url);
  assert.equal(copied.NEON_PARENT_BRANCH_ID, "br-sanitized-parent");
  assert.equal(report.database, "copied");
  assert.equal(report.databaseHost, "ep-other-host");
  assert.equal(report.neonParent, "copied");
});

test("an unparsed database url is not copied", () => {
  const { copied, report } = selectFormaDevSecrets({
    WEWEBPLUS_DATABASE_URL: "not a url",
  });
  assert.equal(copied.WEWEBPLUS_DATABASE_URL, undefined);
  assert.equal(report.database, "excluded_unparsed");
});

test("the forma allowlist does not include inherited AWS names", () => {
  assert.equal(formaSecretNames.includes("AWS_ACCESS_KEY_ID"), false);
  assert.equal(formaSecretNames.includes("AWS_SECRET_ACCESS_KEY"), false);
  assert.equal(formaSecretNames.includes("AWS_REGION"), false);
  assert.equal(formaSecretNames.includes("WEWEBPLUS_DATABASE_URL"), false);
});

test("the forma workflow uses the admin token", () => {
  assert.match(workflow, /cursor\/forma-doppler-5014/);
  assert.match(workflow, /secrets\.DOPPLER_ADMIN_TOKEN/);
  assert.match(workflow, /sudo sh/);
  assert.match(workflow, /node scripts\/gascity\/forma-doppler\.mjs/);
  assert.equal(workflow.includes("set -x"), false);
  assert.equal(workflow.includes("printenv"), false);
  assert.equal(workflow.includes("-c prd"), false);
  assert.equal(workflow.includes("dyad/prd"), false);
  assert.equal(workflow.includes("secrets.DOPPLER_TOKEN"), false);
  assert.equal(workflow.includes("ep-young-wave"), false);
  assert.match(script, /--inherits=aws\.dev/);
  assert.match(script, /"preview"/);
  assert.equal(script.includes("-c prd"), false);
  assert.equal(script.includes("dyad/prd"), false);
  assert.equal(script.includes("printenv"), false);
});
