import assert from "node:assert/strict";
import test from "node:test";
import { removeProjectDatabaseEnv } from "./vercel.mjs";

test("every database env record is removed and its value is not logged", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const method = options.method || "GET";
    calls.push(`${method} ${new URL(url).pathname}`);
    if (url.endsWith("/v9/projects/dyad")) {
      return json({ id: "prj_dyad", name: "dyad", accountId: "team_test" });
    }
    if (url.includes("/env") && method === "GET") {
      const deleted = calls.filter((call) => call.startsWith("DELETE")).length;
      return json({
        envs:
          deleted >= 2
            ? [
                {
                  id: "other",
                  key: "NEXT_PUBLIC_GAS_CITY_URL",
                  target: ["preview"],
                },
              ]
            : [
                {
                  id: "production-db",
                  key: "WEWEBPLUS_DATABASE_URL",
                  target: ["production"],
                  value: "postgresql://role:secret@ep-bold-sky.example/neondb",
                },
                {
                  id: "preview-db",
                  key: "WEWEBPLUS_DATABASE_URL",
                  target: ["preview"],
                  value: "postgresql://role:secret@preview.example/neondb",
                },
                {
                  id: "other",
                  key: "NEXT_PUBLIC_GAS_CITY_URL",
                  target: ["preview"],
                },
              ],
      });
    }
    if (method === "DELETE") return json({});
    throw new Error(`unexpected ${method} ${url}`);
  };
  const removed = await removeProjectDatabaseEnv({
    fetchImpl,
    token: "token",
  });
  assert.equal(removed.removed, 2);
  assert.deepEqual(removed.targets, ["preview", "production"]);
  assert.equal(calls.filter((call) => call.startsWith("DELETE")).length, 2);
  assert.equal(JSON.stringify(calls).includes("secret"), false);
  assert.equal(JSON.stringify(removed).includes("postgresql"), false);
});

test("a team scope error is retried with the team id", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const method = options.method || "GET";
    calls.push(`${method} ${url}`);
    if (url.endsWith("/v9/projects/dyad")) {
      return {
        ok: false,
        status: 403,
        text: async () =>
          JSON.stringify({
            error: {
              message:
                'Not authorized: Trying to access resource under scope "anak2".',
            },
          }),
      };
    }
    if (url.endsWith("/v2/teams")) {
      return json({ teams: [{ id: "team_anak", slug: "anak2" }] });
    }
    if (url.endsWith("/v9/projects/dyad?teamId=team_anak")) {
      return json({ id: "prj_dyad", name: "dyad", accountId: "team_anak" });
    }
    if (url.includes("/env") && method === "GET") {
      return json({ envs: [] });
    }
    throw new Error(`unexpected ${method} ${url}`);
  };
  const removed = await removeProjectDatabaseEnv({
    fetchImpl,
    token: "token",
  });
  assert.equal(removed.removed, 0);
  assert.equal(
    calls.some((call) => call.includes("/v2/teams")),
    true,
  );
  assert.equal(
    calls.some((call) => call.includes("teamId=team_anak")),
    true,
  );
  assert.equal(JSON.stringify(calls).includes("token"), false);
});

function json(body) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  };
}
