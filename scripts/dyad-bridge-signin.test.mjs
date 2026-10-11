import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(
  ".github/workflows/dyad-bridge-signin.yml",
  "utf8",
);
const signIn = fs.readFileSync("e2e-bridge/signin.ts", "utf8");
const spec = fs.readFileSync("e2e-bridge/two-roles.spec.ts", "utf8");
const config = fs.readFileSync("e2e-bridge/playwright.config.cjs", "utf8");
const hitl = fs.readFileSync("src/control_plane/hitl.ts", "utf8");

test("the bridge workflow reads Dyad preview through OIDC and does not print secrets", () => {
  assert.match(workflow, /dopplerhq\/secrets-fetch-action@v2\.0\.0/);
  assert.match(workflow, /auth-method:\s*oidc/);
  assert.match(workflow, /doppler-project:\s*dyad/);
  assert.match(workflow, /doppler-config:\s*preview/);
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /DYAD_BROWSER_BRIDGE:\s*"1"/);
  assert.match(workflow, /WEWEBPLUS_DATABASE_URL:\s*""/);
  assert.doesNotMatch(workflow, /DOPPLER_ADMIN_TOKEN/);
  assert.doesNotMatch(workflow, /verify_bridge/);
  assert.doesNotMatch(
    workflow,
    /echo\s+["']?\$\{?(CLERK_SECRET_KEY|CURSOR_API_KEY)/,
  );
});

test("the bridge sign-in uses the Wewebplus user ids", () => {
  for (const name of [
    "WEWEBPLUS_ORG_ID",
    "WEWEBPLUS_PROJECT_MANAGER_USER_ID",
    "WEWEBPLUS_DEVELOPER_USER_ID",
  ]) {
    const match = hitl.match(new RegExp(`export const ${name} =\\s*"([^"]+)"`));
    assert.ok(match, `${name} missing from hitl.ts`);
    assert.match(signIn, new RegExp(match[1]));
  }
  assert.match(signIn, /createSignInToken/);
  assert.match(signIn, /strategy:\s*"ticket"/);
  assert.doesNotMatch(signIn, /clerk:set-session-token/);
});

test("opening the shared app uses the Apps link and cannot wait forever", () => {
  assert.match(spec, /getByRole\("link", \{ name: "Apps" \}\)/);
  assert.doesNotMatch(spec, /getByRole\("button", \{ name: "Apps" \}\)/);
  assert.match(config, /actionTimeout:\s*30_000/);
  assert.match(signIn, /timeout:\s*60_000/);
});
