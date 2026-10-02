import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { request as httpRequest } from "node:http";
import { eq } from "drizzle-orm";
import { apps, chats } from "@/db/schema";
import { createInMemoryTestDb, type TestDb } from "@/testing/test_db";
import { createFactoryHostBridgeServer } from "./factory_host_bridge_server";
import type { HitlCaller } from "@/control_plane/hitl";

const ORG = "org_wewebplus";

describe("factory host HITL questions", () => {
  let database: TestDb;
  let appId: number;
  let baseUrl: string;
  let server: ReturnType<typeof createFactoryHostBridgeServer>;
  const callers = new Map<string, HitlCaller>([
    [
      "pm",
      {
        orgId: ORG,
        userId: "user_pm",
        roleId: "project-manager",
        displayName: "Anakwannaphaschaiyong",
      },
    ],
    [
      "dev",
      {
        orgId: ORG,
        userId: "user_dev",
        roleId: "developer",
        displayName: "awannaphasch2016",
      },
    ],
    [
      "outsider",
      {
        orgId: "org_other",
        userId: "user_out",
        roleId: "project-manager",
        displayName: "Outsider",
      },
    ],
  ]);

  beforeEach(async () => {
    database = createInMemoryTestDb();
    appId = Number(
      database.insert(apps).values({ name: "Factory", path: "factory" }).run()
        .lastInsertRowid,
    );
    database
      .update(apps)
      .set({ ownerType: "org", ownerId: ORG })
      .where(eq(apps.id, appId))
      .run();
    for (const title of ["Discovery", "Implementation", "Delivery"]) {
      database.insert(chats).values({ appId, title }).run();
    }
    server = createFactoryHostBridgeServer({
      token: "machine-token",
      database,
      resolveCaller: async (token) => callers.get(token) ?? null,
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    database.$client.close();
  });

  const request = (
    path: string,
    init: { method?: string; body?: unknown } = {},
    token = "machine-token",
  ) =>
    new Promise<{ status: number; body: any }>((resolve, reject) => {
      const body =
        init.body === undefined ? undefined : JSON.stringify(init.body);
      const http = httpRequest(`${baseUrl}${path}`, {
        method: init.method ?? "GET",
        headers: {
          ...(body === undefined
            ? {}
            : {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(body),
              }),
          authorization: `Bearer ${token}`,
        },
      });
      http.on("error", reject);
      http.on("response", (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: response.statusCode ?? 0,
            body: raw ? JSON.parse(raw) : null,
          });
        });
      });
      if (body !== undefined) http.write(body);
      http.end();
    });

  const question = {
    idempotencyKey: "run-1:plan-approve",
    runId: "run-1",
    stepId: "plan-approve",
    targetRoleId: "project-manager",
    body: "Approve the plan",
    gateBeadId: "mth-plan",
  };

  it("keeps one question per key and answers it only for the target role", async () => {
    const path = `/v1/apps/${appId}/phases/implementation/questions`;
    const created = await request(path, { method: "POST", body: question });
    expect(created.status).toBe(201);
    const again = await request(path, { method: "POST", body: question });
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(created.body.id);

    const asDev = await request(path, {}, "dev");
    expect(asDev.status).toBe(200);
    expect(asDev.body.questions[0].body).toBeNull();
    expect(asDev.body.questions[0].canAnswer).toBe(false);
    expect(asDev.body.questions[0].stepId).toBe("plan-approve");

    const forbidden = await request(
      `${path}/${created.body.id}/answers`,
      { method: "POST", body: { body: "no" } },
      "dev",
    );
    expect(forbidden.status).toBe(403);

    const hidden = await request(`${path}/${created.body.id}`, {}, "outsider");
    expect(hidden.status).toBe(404);
    const hiddenList = await request(path, {}, "outsider");
    expect(hiddenList.status).toBe(404);

    const allowed = await request(
      `${path}/${created.body.id}/answers`,
      { method: "POST", body: { body: "approved" } },
      "pm",
    );
    expect(allowed.status).toBe(200);
    expect(allowed.body.resolved).toBe(false);
    expect(allowed.body.view.answeredByUserId).toBe("user_pm");

    const second = await request(
      `${path}/${created.body.id}/answers`,
      { method: "POST", body: { body: "again" } },
      "pm",
    );
    expect(second.status).toBe(200);
    expect(second.body.resolved).toBe(false);
  });
});
