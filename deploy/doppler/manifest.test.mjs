import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const manifest = JSON.parse(
  readFileSync(new URL("manifest.json", import.meta.url), "utf8"),
);

function names(slug) {
  return manifest.environments[slug].names;
}

test("every secret the operational workflows read is in the ci environment", () => {
  const ci = new Set(names("ci"));
  for (const file of manifest.operationalWorkflows) {
    const text = readFileSync(
      new URL(`.github/workflows/${file}`, root),
      "utf8",
    );
    for (const match of text.matchAll(/secrets\.([A-Z_][A-Z0-9_]*)/g)) {
      const name = match[1];
      // GitHub's own token, and the three names the Doppler sync writes about itself.
      if (
        name === "GITHUB_TOKEN" ||
        /^DOPPLER_(PROJECT|CONFIG|ENVIRONMENT)$/.test(name)
      )
        continue;
      assert.ok(
        ci.has(name),
        `${file} reads secrets.${name}, which is not in manifest ci`,
      );
    }
  }
});

test("the prd environment is exactly the rollout allowlist minus the aws project's names", () => {
  const source = readFileSync(
    new URL("scripts/gascity/write_rollout_env.py", root),
    "utf8",
  );
  const block = source.match(/ALLOW = \(([\s\S]*?)\)/);
  assert.ok(block, "ALLOW tuple not found");
  const allow = [...block[1].matchAll(/"([A-Z_][A-Z0-9_]*)"/g)].map(
    (m) => m[1],
  );
  const fromDyad = allow.filter((n) => !n.startsWith("AWS_"));
  assert.deepEqual([...names("prd")].sort(), fromDyad.sort());
});

test("ci and prd share no names and the ssh key never reaches the host", () => {
  const ci = new Set(names("ci"));
  for (const name of names("prd"))
    assert.ok(!ci.has(name), `${name} is in both ci and prd`);
  assert.ok(!names("prd").includes("EC2_SSH_KEY"));
});

test("names are sorted and valid Doppler classic names", () => {
  for (const slug of Object.keys(manifest.environments)) {
    const list = names(slug);
    assert.deepEqual(list, [...list].sort(), `${slug} names are not sorted`);
    for (const name of list) assert.match(name, /^[A-Z][A-Z0-9_]*$/);
  }
});

test("the Doppler workflows authenticate by OIDC and store no token", () => {
  const action = readFileSync(
    new URL(".github/actions/doppler-oidc/action.yml", root),
    "utf8",
  );
  assert.match(action, /api\.doppler\.com\/v3\/auth\/oidc/);
  assert.match(action, /::add-mask::/);
  assert.doesNotMatch(
    action,
    /dp\.(st|sa|ct|pt)\./,
    "action must not contain a Doppler token",
  );
  for (const file of [
    "doppler-organize.yml",
    "ec2-access-check.yml",
    "gascity-rollout.yml",
    "preview-formula-role.yml",
  ]) {
    const text = readFileSync(
      new URL(`.github/workflows/${file}`, root),
      "utf8",
    );
    assert.match(
      text,
      /id-token: write/,
      `${file} needs id-token: write for OIDC`,
    );
    assert.match(
      text,
      /uses: \.\/\.github\/actions\/doppler-oidc/,
      `${file} uses the OIDC action`,
    );
  }
  const organize = readFileSync(
    new URL(".github/workflows/doppler-organize.yml", root),
    "utf8",
  );
  assert.doesNotMatch(
    organize,
    /secrets\.DOPPLER_TOKEN/,
    "organize must not depend on a stored token",
  );
  for (const command of ["status", "phase1", "verify"]) {
    assert.match(organize, new RegExp(`migrate\\.mjs ${command}`));
  }
  const identity = readFileSync(new URL("identity", import.meta.url), "utf8");
  for (const line of identity.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    assert.match(
      line,
      /^[0-9a-fA-F-]{36}$/,
      "identity file holds a UUID or comments only",
    );
  }
});
