import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  configReport,
  dyadDevStatus,
  inheritsLabel,
  projectBody,
  redact,
  VIBESDK_PROJECT_NAME,
} from "./vibesdk-project.mjs";

const ensureScript = readFileSync(
  new URL("./ensure-vibesdk-project.mjs", import.meta.url),
  "utf8",
);

test("the vibesdk project is separate and does not inherit dyad", () => {
  const body = projectBody();
  assert.equal(body.name, VIBESDK_PROJECT_NAME);
  assert.match(body.description, /not inherited from dyad/);
  assert.equal(body.description.includes("dyad/dev"), false);
});

test("config parents are reported without secret values", () => {
  assert.equal(inheritsLabel({}), "none");
  assert.equal(inheritsLabel({ inherits: null }), "none");
  assert.equal(inheritsLabel({ inherits: "dev" }), "dev");
  assert.equal(inheritsLabel({ inherits: { name: "dev" } }), "dev");
  assert.deepEqual(
    configReport([
      { name: "dev", inherits: null },
      { name: "dev_personal", inherits: "dev" },
    ]),
    ["config=dev inherits=none", "config=dev_personal inherits=dev"],
  );
});

test("dyad/dev is recorded as absent when that config is missing", () => {
  assert.equal(
    dyadDevStatus([{ name: "preview" }, { name: "prd" }, { name: "canary" }]),
    "absent",
  );
  assert.equal(dyadDevStatus([{ name: "dev" }]), "present");
});

test("error text drops Doppler token prefixes", () => {
  assert.equal(
    redact("rejected dp.pt.secretvalue and dp.st.othervalue"),
    "rejected dp.redacted and dp.redacted",
  );
});

test("the setup script never downloads or copies secrets", () => {
  assert.equal(ensureScript.includes("secrets/download"), false);
  assert.equal(ensureScript.includes("WEWEBPLUS_DATABASE_URL"), false);
  assert.equal(ensureScript.includes("GAS_CITY_HOST_BRIDGE_TOKEN"), false);
  assert.match(ensureScript, /inherit=no/);
  assert.match(ensureScript, /secret_copy=no/);
});
