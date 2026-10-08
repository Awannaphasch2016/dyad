import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertPreviewHost } from "./host.mjs";
import {
  assertDatabaseUrl,
  assertDeletableBranch,
  assertSchemaSql,
  deleteNeonBranch,
  ensureNeonBranch,
  pgModuleHref,
  probePreview,
  redact,
  runtimeEnvironment,
  serviceDocument,
  serviceName,
  taskDefinitionDocument,
} from "./launch.mjs";

const parentId = "br-round-night-b33xeq5p";
const direct =
  "postgres://neondb_owner:secret@ep-preview-leaf.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";
const pooled =
  "postgres://neondb_owner:secret@ep-preview-leaf-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
    async json() {
      return body;
    },
  };
}

function hostRecord() {
  return assertPreviewHost(
    JSON.parse(readFileSync(new URL("./host.json", import.meta.url), "utf8")),
  );
}

test("redact hides database urls and credentials", () => {
  const raw = [
    "postgres://neondb_owner:secret@ep-preview-leaf.aws.neon.tech/neondb",
    "sk-or-v1-abcdefghijklmnopqrstuvwxyz",
    "sk-abcdefghijklmnopqrstuvwxyz",
    "AKIA1234567890ABCDEF",
    "ASIA1234567890ABCDEF",
    "dp.st.abcdefghijklmnopqrstuvwxyz",
    '{"password":"hunter2","uri":"postgres://a:b@h/db"}',
  ].join(" ");
  const hidden = redact(raw);
  assert.equal(hidden.includes("secret@"), false);
  assert.equal(hidden.includes("sk-or-v1-abc"), false);
  assert.equal(hidden.includes("AKIA1234"), false);
  assert.equal(hidden.includes("ASIA1234"), false);
  assert.equal(hidden.includes("dp.st.abc"), false);
  assert.equal(hidden.includes("hunter2"), false);
  assert.match(hidden, /postgres:\/\/redacted/);
});

test("database hosts must match the pool mode and stay off production", () => {
  assert.equal(
    assertDatabaseUrl(pooled, { pooled: true }).includes("-pooler"),
    true,
  );
  assert.throws(() => assertDatabaseUrl(direct, { pooled: true }), /pool mode/);
  assert.throws(
    () =>
      assertDatabaseUrl(
        "postgres://u:p@ep-young-wave-b3cwe0rz.aws.neon.tech/neondb",
        { pooled: false },
      ),
    /production/,
  );
  assert.throws(
    () =>
      assertDatabaseUrl("postgres://u:p@ep-mute-credit.aws.neon.tech/neondb", {
        pooled: false,
      }),
    /production/,
  );
  assert.throws(
    () => assertDatabaseUrl("not a url", { pooled: false }),
    /invalid/,
  );
});

test("the task receives forma runtime values and listens on every interface", () => {
  const environment = runtimeEnvironment({
    pooledUrl: pooled,
    appUrl: "http://preview-forma-2018533952.ap-southeast-1.elb.amazonaws.com",
    secrets: {
      APP_PASSWORD: "pw",
      AUTH_SECRET: "auth-secret",
      CRON_SECRET: "cron-secret",
      OPENROUTER_API_KEY: "sk-or-test-value",
      OPENAI_API_KEY: "sk-do-not-copy",
    },
  });
  assert.equal(environment.OPENAI_API_KEY, undefined);
  assert.equal(environment.OPENROUTER_API_KEY, "sk-or-test-value");
  assert.throws(
    () =>
      runtimeEnvironment({
        pooledUrl: pooled,
        appUrl: "https://example.com",
        secrets: {
          APP_PASSWORD: "pw",
          AUTH_SECRET: "auth-secret",
          CRON_SECRET: "cron-secret",
          OPENROUTER_API_KEY: "sk-or-test-value",
        },
      }),
    /load balancer/,
  );
  assert.throws(
    () =>
      runtimeEnvironment({
        pooledUrl: pooled,
        appUrl:
          "http://preview-forma-2018533952.ap-southeast-1.elb.amazonaws.com",
        secrets: { APP_PASSWORD: "pw" },
      }),
    /AUTH_SECRET/,
  );
  const document = taskDefinitionDocument({
    host: hostRecord(),
    image:
      "ghcr.io/awannaphasch2016/forma:sha-80a8e419f6285378b4dfada336ea8213f3089bab",
    environment,
  });
  const container = document.containerDefinitions[0];
  assert.deepEqual(container.command, [
    "pnpm",
    "run",
    "start",
    "--",
    "-H",
    "0.0.0.0",
    "-p",
    "3000",
  ]);
  const names = container.environment.map((item) => item.name);
  assert.equal(names.includes("DATABASE_URL"), true);
  assert.equal(names.includes("HOSTNAME"), true);
  assert.equal(
    names.some((name) => name.startsWith("OPENAI_")),
    false,
  );
  assert.equal(document.cpu, "512");
  assert.equal(document.memory, "1024");
  const service = serviceDocument({
    host: hostRecord(),
    service: serviceName(82),
    taskDefinitionArn:
      "arn:aws:ecs:ap-southeast-1:755283537543:task-definition/preview-forma:2",
  });
  assert.equal(service.serviceName, "preview-forma-82");
  assert.equal(service.desiredCount, 1);
  assert.equal(
    service.networkConfiguration.awsvpcConfiguration.assignPublicIp,
    "ENABLED",
  );
  assert.equal(service.loadBalancers[0].containerPort, 3000);
});

test("schema sql must create login attempts and the client path is explicit", () => {
  assert.throws(() => assertSchemaSql("select 1"), /login_attempts/);
  assert.match(
    assertSchemaSql("CREATE TABLE IF NOT EXISTS login_attempts ()"),
    /login_attempts/,
  );
  assert.equal(pgModuleHref(""), "pg");
  assert.match(
    pgModuleHref("/tmp/preview-pg"),
    /\/tmp\/preview-pg\/node_modules\/pg\/lib\/index\.js$/,
  );
});

test("a missing preview branch is created from the forma parent", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const method = options.method || "GET";
    calls.push(`${method} ${url}`);
    if (method === "GET" && url.includes("/branches?")) {
      return jsonResponse({ branches: [] });
    }
    if (method === "POST" && url.endsWith("/branches")) {
      const body = JSON.parse(options.body);
      assert.equal(body.branch.parent_id, parentId);
      assert.equal(body.branch.name, "preview-forma-82");
      assert.equal(body.branch.init_source, "parent-schema");
      return jsonResponse({
        branch: {
          id: "br-child",
          name: "preview-forma-82",
          parent_id: parentId,
        },
        operations: [{ id: "op1" }],
      });
    }
    if (url.includes("/operations/op1")) {
      return jsonResponse({ operation: { status: "finished" } });
    }
    if (url.includes("connection_uri")) {
      const usePool = new URL(url).searchParams.get("pooled") === "true";
      return jsonResponse({ uri: usePool ? pooled : direct });
    }
    throw new Error(`unexpected ${method} ${url}`);
  };
  const branch = await ensureNeonBranch({
    apiKey: "neon-test",
    pr: "82",
    fetchImpl,
    sleep: async () => {},
  });
  assert.equal(branch.name, "preview-forma-82");
  assert.equal(branch.id, "br-child");
  assert.equal(new URL(branch.direct).hostname.includes("-pooler"), false);
  assert.equal(new URL(branch.pooled).hostname.includes("-pooler"), true);
  assert.equal(
    calls.some((call) => call.startsWith("POST ")),
    true,
  );
});

test("an existing preview branch is reused and a bad parent is refused", async () => {
  let posts = 0;
  const fetchImpl = async (url, options = {}) => {
    if ((options.method || "GET") === "POST") posts += 1;
    if (url.includes("/branches?")) {
      return jsonResponse({
        branches: [
          { id: parentId, name: "main", parent_id: null },
          {
            id: "br-child",
            name: "preview-forma-82",
            parent_id: parentId,
          },
        ],
      });
    }
    if (url.includes("connection_uri")) {
      const usePool = new URL(url).searchParams.get("pooled") === "true";
      return jsonResponse({ uri: usePool ? pooled : direct });
    }
    throw new Error(url);
  };
  const branch = await ensureNeonBranch({
    apiKey: "neon-test",
    pr: "82",
    fetchImpl,
    sleep: async () => {},
  });
  assert.equal(branch.id, "br-child");
  assert.equal(posts, 0);

  const wrongParent = async (url) => {
    if (url.includes("/branches?")) {
      return jsonResponse({
        branches: [
          {
            id: "br-child",
            name: "preview-forma-82",
            parent_id: "br-somewhere-else",
          },
        ],
      });
    }
    throw new Error(url);
  };
  await assert.rejects(
    () =>
      ensureNeonBranch({
        apiKey: "neon-test",
        pr: "82",
        fetchImpl: wrongParent,
        sleep: async () => {},
      }),
    /wrong parent/,
  );
});

test("a production connection uri is refused without retrying", async () => {
  let sleeps = 0;
  const fetchImpl = async (url) => {
    if (url.includes("/branches?")) {
      return jsonResponse({
        branches: [
          {
            id: "br-child",
            name: "preview-forma-82",
            parent_id: parentId,
          },
        ],
      });
    }
    return jsonResponse({
      uri: "postgres://u:p@ep-young-wave-b3cwe0rz.aws.neon.tech/neondb",
    });
  };
  await assert.rejects(
    () =>
      ensureNeonBranch({
        apiKey: "neon-test",
        pr: "82",
        fetchImpl,
        sleep: async () => {
          sleeps += 1;
        },
      }),
    /production/,
  );
  assert.equal(sleeps, 0);
});

test("a neon operation that never finishes is refused", async () => {
  let polls = 0;
  const fetchImpl = async (url, options = {}) => {
    if ((options.method || "GET") === "GET" && url.includes("/branches?")) {
      return jsonResponse({ branches: [] });
    }
    if (options.method === "POST") {
      return jsonResponse({
        branch: {
          id: "br-child",
          name: "preview-forma-82",
          parent_id: parentId,
        },
        operations: [{ id: "op-slow" }],
      });
    }
    if (url.includes("/operations/op-slow")) {
      polls += 1;
      return jsonResponse({ operation: { status: "running" } });
    }
    throw new Error(url);
  };
  await assert.rejects(
    () =>
      ensureNeonBranch({
        apiKey: "neon-test",
        pr: "82",
        fetchImpl,
        sleep: async () => {},
      }),
    /did not finish/,
  );
  assert.equal(polls, 30);
});

test("cleanup deletes only this preview branch", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const method = options.method || "GET";
    calls.push(`${method} ${url}`);
    if (method === "GET") {
      return jsonResponse({
        branches: [
          { id: parentId, name: "main", parent_id: null },
          {
            id: "br-vercel",
            name: "forma-pr-2",
            parent_id: parentId,
          },
          {
            id: "br-child",
            name: "preview-forma-82",
            parent_id: parentId,
          },
        ],
      });
    }
    if (method === "DELETE") {
      assert.match(url, /\/branches\/br-child$/);
      return jsonResponse({});
    }
    throw new Error(`${method} ${url}`);
  };
  const deleted = await deleteNeonBranch({
    apiKey: "neon-test",
    pr: "82",
    fetchImpl,
  });
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.name, "preview-forma-82");
  assert.equal(calls.filter((call) => call.startsWith("DELETE ")).length, 1);
  assert.equal(
    calls.some((call) => call.includes(parentId)),
    false,
  );
  assert.equal(
    calls.some((call) => call.includes("br-vercel")),
    false,
  );

  const absent = await deleteNeonBranch({
    apiKey: "neon-test",
    pr: "82",
    fetchImpl: async () => jsonResponse({ branches: [] }),
  });
  assert.equal(absent.deleted, false);

  await assert.rejects(
    () =>
      deleteNeonBranch({
        apiKey: "neon-test",
        pr: "82",
        fetchImpl: async () =>
          jsonResponse({
            branches: [
              {
                id: "br-child",
                name: "preview-forma-82",
                parent_id: "br-somewhere-else",
              },
            ],
          }),
      }),
    /parent/,
  );
  assert.throws(
    () =>
      assertDeletableBranch(
        { id: parentId, name: "preview-forma-82", parent_id: parentId },
        "preview-forma-82",
      ),
    /parent/,
  );
  assert.throws(
    () =>
      assertDeletableBranch(
        { id: "br-vercel", name: "forma-pr-2", parent_id: parentId },
        "forma-pr-2",
      ),
    /Refusing/,
  );
});

test("the public probe requires openrouter and rejects a wrong password", async () => {
  const appUrl =
    "http://preview-forma-2018533952.ap-southeast-1.elb.amazonaws.com";
  const ok = await probePreview(appUrl, async (url, options = {}) => {
    if (url.endsWith("/api/status")) {
      return jsonResponse({ configured: true, provider: "openrouter" });
    }
    assert.equal(options.method, "POST");
    assert.equal(options.headers.origin, appUrl);
    assert.equal(JSON.parse(options.body).password, "wrong-password");
    return jsonResponse({ error: "That password is incorrect." }, 401);
  });
  assert.deepEqual(ok, {
    configured: true,
    provider: "openrouter",
    password: 401,
  });
  await assert.rejects(
    () =>
      probePreview(appUrl, async () =>
        jsonResponse({ configured: false, provider: "unconfigured" }),
      ),
    /provider=unconfigured/,
  );
  await assert.rejects(
    () =>
      probePreview(appUrl, async (url) => {
        if (url.endsWith("/api/status")) {
          return jsonResponse({ configured: true, provider: "openrouter" });
        }
        return jsonResponse({ error: "Request origin is not allowed." }, 403);
      }),
    /password=403/,
  );
});
