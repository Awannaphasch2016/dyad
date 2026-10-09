import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { request as httpRequest } from "node:http";
import { eq } from "drizzle-orm";
import { apps, chats, hitlQuestions } from "@/db/schema";
import { createInMemoryTestDb, type TestDb } from "@/testing/test_db";
import { createFactoryHostBridgeServer } from "./factory_host_bridge_server";
import { resumeAnsweredFactoryQuestions } from "@/control_plane/hitl_device";
import type { HitlCaller } from "@/control_plane/hitl";

const ORG = "org_wewebplus";

describe("factory host HITL questions", () => {
  let database: TestDb;
  let appId: number;
  let baseUrl: string;
  let server: ReturnType<typeof createFactoryHostBridgeServer>;
  let dispatched: { prompt: string }[];
  let crashResume: boolean;
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
    dispatched = [];
    crashResume = false;
    server = createFactoryHostBridgeServer({
      token: "machine-token",
      database,
      resolveCaller: async (token) => callers.get(token) ?? null,
      dispatchChatIntent: async (intent) => {
        if (crashResume && intent.prompt.includes("Use Tiny Bakery")) {
          throw new Error("crash");
        }
        dispatched.push({ prompt: intent.prompt });
        return "accepted";
      },
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

  it("stores a role request without a bead and still refuses a mismatched gate", async () => {
    const path = `/v1/apps/${appId}/phases/implementation/questions`;
    const created = await request(path, {
      method: "POST",
      body: {
        idempotencyKey: "run-2:question",
        runId: "run-2",
        stepId: "question",
        targetRoleId: "developer",
        body: "Which name should the page use?",
      },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      stepId: "question",
      targetRoleId: "developer",
      status: "open",
    });
    const stored = database
      .select()
      .from(hitlQuestions)
      .where(eq(hitlQuestions.id, created.body.id))
      .get();
    expect(stored?.beadId).toBeNull();

    const wrongGate = await request(path, {
      method: "POST",
      body: {
        idempotencyKey: "run-3:plan-approve",
        runId: "run-3",
        stepId: "plan-approve",
        targetRoleId: "developer",
        body: "Approve the plan",
      },
    });
    expect(wrongGate.status).toBe(400);
  });

  it("starts one resume run from an answer and ignores a second answer", async () => {
    const linked = await request(`/v1/apps/${appId}/link`, {
      method: "PUT",
      body: { gasCityProjectId: "gc-resume" },
    });
    expect(linked.status).toBe(200);
    const started = await request(
      `/v1/apps/${appId}/phases/implementation/runs`,
      {
        method: "POST",
        body: { idempotencyKey: "build-1", prompt: "Build the page" },
      },
    );
    expect(started.status).toBe(202);
    const asked = await request(
      `/v1/apps/${appId}/phases/implementation/questions`,
      {
        method: "POST",
        body: {
          idempotencyKey: "build-1:question",
          runId: started.body.runId,
          stepId: "question",
          targetRoleId: "developer",
          body: "Which name should the page use?",
        },
      },
    );
    expect(asked.status).toBe(201);
    const before = dispatched.length;

    const answered = await request(
      `/v1/apps/${appId}/phases/implementation/questions/${asked.body.id}/answers`,
      { method: "POST", body: { body: "Use Tiny Bakery" } },
      "dev",
    );
    expect(answered.status).toBe(200);
    expect(answered.body.resolved).toBe(true);
    const resumes = dispatched.slice(before);
    expect(resumes).toHaveLength(1);
    expect(resumes[0]?.prompt).toContain("Which name should the page use?");
    expect(resumes[0]?.prompt).toContain("Use Tiny Bakery");

    const again = await request(
      `/v1/apps/${appId}/phases/implementation/questions/${asked.body.id}/answers`,
      { method: "POST", body: { body: "Use Tiny Bakery again" } },
      "dev",
    );
    expect(again.status).toBe(200);
    expect(again.body.resolved).toBe(false);
    expect(dispatched).toHaveLength(before + 1);
  });

  it("resumes one accepted run after the dispatch crashes", async () => {
    crashResume = true;
    await request(`/v1/apps/${appId}/link`, {
      method: "PUT",
      body: { gasCityProjectId: "gc-crash" },
    });
    const started = await request(
      `/v1/apps/${appId}/phases/implementation/runs`,
      {
        method: "POST",
        body: { idempotencyKey: "build-crash", prompt: "Build the page" },
      },
    );
    expect(started.status).toBe(202);
    const asked = await request(
      `/v1/apps/${appId}/phases/implementation/questions`,
      {
        method: "POST",
        body: {
          idempotencyKey: "build-crash:question",
          runId: started.body.runId,
          stepId: "question",
          targetRoleId: "developer",
          body: "Which name should the page use?",
        },
      },
    );
    const answered = await request(
      `/v1/apps/${appId}/phases/implementation/questions/${asked.body.id}/answers`,
      { method: "POST", body: { body: "Use Tiny Bakery" } },
      "dev",
    );
    expect(answered.body.resolved).toBe(false);
    expect(
      dispatched.some((intent) => intent.prompt.includes("Use Tiny Bakery")),
    ).toBe(false);

    const recovered: { prompt: string }[] = [];
    const recover = async (intent: { prompt: string }) => {
      recovered.push({ prompt: intent.prompt });
      return "accepted" as const;
    };
    expect(await resumeAnsweredFactoryQuestions(database, recover)).toBe(1);
    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.prompt).toContain("Use Tiny Bakery");
    expect(await resumeAnsweredFactoryQuestions(database, recover)).toBe(0);
    expect(recovered).toHaveLength(1);
  });
});
