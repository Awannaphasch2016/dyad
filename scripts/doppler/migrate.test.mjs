import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { main, makeClient } from "./migrate.mjs";

const manifest = {
  project: "dyad",
  sources: ["preview", "dev"],
  environments: {
    ci: { names: ["DOPPLER_TOKEN", "EC2_SSH_KEY", "NEON_API_KEY"] },
    prd: { names: ["CLERK_SECRET_KEY", "NOVNC_PASSWORD"] },
  },
};

// An in-memory Doppler: environments, configs, and raw secrets per config.
function fakeDoppler(initial) {
  const state = structuredClone(initial);
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || "GET";
    const path = u.pathname.replace("/v3", "");
    const project = u.searchParams.get("project");
    const config = u.searchParams.get("config");
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, path, project, config, body });
    const json = (status, data) => ({
      ok: status < 400,
      status,
      json: async () => data,
    });
    const auth = init.headers.Authorization || "";
    if (path === "/configs/config" && !project) {
      const bound = state.tokens[auth.replace("Bearer ", "")];
      if (!bound) return json(401, { messages: ["Invalid Auth token"] });
      return json(200, {
        config: { project: bound.project, name: bound.config },
      });
    }
    if (auth !== "Bearer admin")
      return json(401, { messages: ["Invalid Auth token"] });
    if (path === "/environments" && method === "GET")
      return json(200, {
        environments: state.environments.map((slug) => ({ slug })),
      });
    if (path === "/environments" && method === "POST") {
      state.environments.push(body.slug);
      state.configs[body.slug] = {};
      return json(200, { environment: { slug: body.slug } });
    }
    if (path === "/configs/config/secrets/names")
      return json(200, { names: Object.keys(state.configs[config] || {}) });
    if (path === "/configs/config/secrets" && method === "GET") {
      const secrets = {};
      for (const [k, v] of Object.entries(state.configs[config] || {}))
        secrets[k] = { raw: v, computed: v };
      return json(200, { secrets });
    }
    if (path === "/configs/config/secrets" && method === "POST") {
      Object.assign(state.configs[body.config], body.secrets);
      return json(200, { secrets: {} });
    }
    return json(404, { messages: [`no route ${method} ${path}`] });
  };
  return { fetchImpl, state, calls };
}

const seeded = {
  environments: ["dev", "preview"],
  configs: {
    // The SSH key lives in dev, not preview.
    dev: {
      EC2_SSH_KEY: "-----BEGIN OPENSSH PRIVATE KEY-----\nkeybody\n",
      NEON_API_KEY: "stale-dev-neon-value",
    },
    preview: {
      DOPPLER_TOKEN: "dp.st.preview.secret-token-value",
      NEON_API_KEY: "neon-value",
      CLERK_SECRET_KEY: "clerk-value",
      NOVNC_PASSWORD: "novnc-value",
      WEWEBPLUS_DATABASE_URL: "postgres://x",
    },
  },
  tokens: {
    "dp.st.preview.secret-token-value": { project: "dyad", config: "preview" },
  },
};

function capture() {
  const out = [];
  const err = [];
  return {
    io: {
      stdout: (t) => out.push(t),
      stderr: (t) => err.push(t),
      token: "admin",
    },
    out: () => out.join("\n"),
    err: () => err.join("\n"),
  };
}

function assertNoValues(text) {
  for (const value of [
    ...Object.values(seeded.configs.preview),
    ...Object.values(seeded.configs.dev),
  ]) {
    assert.ok(
      !text.includes(value.split("\n")[0]),
      `output leaked a secret value`,
    );
  }
}

test("status reports what exists and what is missing without values", async () => {
  const d = fakeDoppler(seeded);
  const c = capture();
  const code = await main(["status"], {
    ...c.io,
    manifest,
    client: makeClient("admin", d.fetchImpl),
  });
  assert.equal(code, 0);
  assert.match(c.out(), /project=dyad environments=dev,preview/);
  assert.match(c.out(), /source_preview=5/);
  assert.match(c.out(), /source_dev=1/);
  assert.match(c.out(), /ci=absent wanted=3 present=0 missing=3/);
  assert.match(c.out(), /ci_from_preview=DOPPLER_TOKEN,NEON_API_KEY/);
  assert.match(c.out(), /ci_from_dev=EC2_SSH_KEY/);
  assert.match(c.out(), /prd=absent wanted=2 present=0 missing=2/);
  assertNoValues(c.out());
});

test("phase1 creates the environments, copies only the manifest names, and is idempotent", async () => {
  const d = fakeDoppler(seeded);
  const c = capture();
  const client = makeClient("admin", d.fetchImpl);
  assert.equal(await main(["phase1"], { ...c.io, manifest, client }), 0);
  assert.match(c.out(), /ci_environment=created/);
  assert.match(c.out(), /prd_environment=created/);
  assert.match(c.out(), /ci_copied=3 already=0/);
  assert.match(c.out(), /prd_copied=2 already=0/);
  assert.deepEqual(Object.keys(d.state.configs.ci).sort(), [
    "DOPPLER_TOKEN",
    "EC2_SSH_KEY",
    "NEON_API_KEY",
  ]);
  assert.deepEqual(Object.keys(d.state.configs.prd).sort(), [
    "CLERK_SECRET_KEY",
    "NOVNC_PASSWORD",
  ]);
  // WEWEBPLUS_DATABASE_URL is in preview but in neither manifest list.
  assert.ok(!("WEWEBPLUS_DATABASE_URL" in d.state.configs.prd));
  // The first source that has a name wins; dev only supplies what preview lacks.
  assert.equal(d.state.configs.ci.NEON_API_KEY, "neon-value");
  assert.equal(d.state.configs.ci.EC2_SSH_KEY, seeded.configs.dev.EC2_SSH_KEY);
  // The sources are untouched.
  assert.equal(Object.keys(d.state.configs.preview).length, 5);
  assert.equal(Object.keys(d.state.configs.dev).length, 2);
  assert.ok(!d.calls.some((call) => call.method === "DELETE"));
  assertNoValues(c.out());

  const again = capture();
  const before = d.calls.length;
  assert.equal(await main(["phase1"], { ...again.io, manifest, client }), 0);
  assert.match(again.out(), /ci_environment=present/);
  assert.match(again.out(), /ci_copied=0 already=3/);
  assert.ok(
    !d.calls.slice(before).some((call) => call.method === "POST"),
    "second run must not write anything",
  );
});

test("phase1 reports names the source does not have and exits 1", async () => {
  const d = fakeDoppler({
    ...seeded,
    configs: { dev: {}, preview: { NOVNC_PASSWORD: "x" } },
  });
  const c = capture();
  const code = await main(["phase1"], {
    ...c.io,
    manifest,
    client: makeClient("admin", d.fetchImpl),
  });
  assert.equal(code, 1);
  assert.match(
    c.out(),
    /ci_absent_in_sources=DOPPLER_TOKEN,EC2_SSH_KEY,NEON_API_KEY/,
  );
  assert.match(c.out(), /prd_absent_in_sources=CLERK_SECRET_KEY/);
});

test("verify checks names and that ci's DOPPLER_TOKEN really reads the preview config", async () => {
  const d = fakeDoppler(seeded);
  const client = makeClient("admin", d.fetchImpl);
  await main(["phase1"], { ...capture().io, manifest, client });
  const c = capture();
  assert.equal(await main(["verify"], { ...c.io, manifest, client }), 0);
  assert.match(c.out(), /ci=present missing=0 extra=0/);
  assert.match(
    c.out(),
    /ci_doppler_token=http-200 project=dyad config=preview/,
  );
  assert.match(c.out(), /phase1=ok/);
  assertNoValues(c.out());

  d.state.configs.ci.DOPPLER_TOKEN = "dp.st.preview.revoked";
  const bad = capture();
  assert.equal(await main(["verify"], { ...bad.io, manifest, client }), 1);
  assert.match(bad.out(), /ci_doppler_token=http-401/);
  assert.match(bad.out(), /phase1=incomplete/);
});

test("a rejected admin token is reported as AUTH_REQUIRED", async () => {
  const d = fakeDoppler(seeded);
  const c = capture();
  const code = await main(["status"], {
    ...c.io,
    token: "wrong",
    manifest,
    client: makeClient("wrong", d.fetchImpl),
  });
  assert.equal(code, 3);
  assert.match(c.err(), /code: AUTH_REQUIRED/);
});

test("the script refuses to run without a token or a command", () => {
  const cwd = new URL("../../", import.meta.url);
  const env = { ...process.env };
  delete env.DOPPLER_TOKEN;
  const noToken = spawnSync(
    process.execPath,
    ["scripts/doppler/migrate.mjs", "status"],
    {
      cwd,
      env,
      encoding: "utf8",
    },
  );
  assert.equal(noToken.status, 3);
  assert.match(noToken.stderr, /AUTH_REQUIRED/);
  const noCommand = spawnSync(
    process.execPath,
    ["scripts/doppler/migrate.mjs"],
    {
      cwd,
      env,
      encoding: "utf8",
    },
  );
  assert.equal(noCommand.status, 2);
});
