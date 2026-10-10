import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setSessionVerifierForTesting } from "@/control_plane/access";
import {
  clearSessionTokensForTesting,
  rememberSessionToken,
} from "@/control_plane/session_store";
import { setDatabaseForTesting } from "@/db";
import { apps, chats, factoryPhaseApprovals } from "@/db/schema";
import { DyadErrorKind } from "@/errors/dyad_error";
import { createFactoryHostBridgeServer } from "@/main/factory_host_bridge_server";
import { createInMemoryTestDb, type TestDb } from "@/testing/test_db";
import { getRegisteredHandlerForTesting } from "./base";
import { registerFactoryHandlers } from "./factory_handlers";
import { registerFactoryHostHandlers } from "./factory_host_handlers";

const event = { sender: { id: 7 } } as never;
const ORG = "org_wewebplus";

function signedIn(roleId: "developer" | "project-manager") {
  setSessionVerifierForTesting(async () => ({
    userId: roleId === "developer" ? "user_dev" : "user_pm",
    orgId: ORG,
    roleId,
    canInvite: false,
    displayName: roleId === "developer" ? "Developer" : "Project Manager",
    member: true,
  }));
}

describe("factory phase approval", () => {
  const previous = {
    publishable: process.env.CLERK_PUBLISHABLE_KEY,
    secret: process.env.CLERK_SECRET_KEY,
    database: process.env.WEWEBPLUS_DATABASE_URL,
  };
  let database: TestDb;
  let appId: number;

  beforeEach(() => {
    database = createInMemoryTestDb();
    setDatabaseForTesting(database);
    process.env.CLERK_PUBLISHABLE_KEY = "pk_test_example";
    process.env.CLERK_SECRET_KEY = "sk_test_example";
    delete process.env.WEWEBPLUS_DATABASE_URL;
    rememberSessionToken(7, "session-token");
    appId = database
      .insert(apps)
      .values({
        name: "Factory",
        path: "factory",
        ownerType: "org",
        ownerId: ORG,
        factoryHostManaged: true,
        gasCityProjectId: "gc-b1",
      })
      .returning()
      .get().id;
    for (const title of ["Discovery", "Implementation", "Delivery"]) {
      database.insert(chats).values({ appId, title }).run();
    }
    registerFactoryHandlers();
    registerFactoryHostHandlers();
  });

  afterEach(async () => {
    setSessionVerifierForTesting(null);
    clearSessionTokensForTesting();
    setDatabaseForTesting(null);
    database.$client.close();
    restoreEnv("CLERK_PUBLISHABLE_KEY", previous.publishable);
    restoreEnv("CLERK_SECRET_KEY", previous.secret);
    restoreEnv("WEWEBPLUS_DATABASE_URL", previous.database);
  });

  it("refuses a developer on both approval paths", async () => {
    signedIn("developer");
    const accountApprove = getRegisteredHandlerForTesting("factory:approve");
    const hostApprove = getRegisteredHandlerForTesting(
      "factory-host:approve-phase",
    );

    await expect(
      accountApprove(event, { appId, phase: "discovery" }),
    ).rejects.toMatchObject({
      name: "DyadError",
      kind: DyadErrorKind.Auth,
      message: "Your role can't do that.",
    });
    await expect(
      hostApprove(event, { appId, phase: "implementation" }),
    ).rejects.toMatchObject({
      name: "DyadError",
      kind: DyadErrorKind.Auth,
      message: "Your role can't do that.",
    });
    expect(database.select().from(factoryPhaseApprovals).all()).toHaveLength(0);
  });

  it("records a project-manager approval on both paths", async () => {
    signedIn("project-manager");
    const accountApprove = getRegisteredHandlerForTesting("factory:approve");
    const hostApprove = getRegisteredHandlerForTesting(
      "factory-host:approve-phase",
    );

    await accountApprove(event, { appId, phase: "discovery" });
    const state = await hostApprove(event, {
      appId,
      phase: "implementation",
    });

    expect(state).toMatchObject({
      appId,
      approvedPhases: ["discovery", "implementation"],
    });
    const rows = database
      .select()
      .from(factoryPhaseApprovals)
      .where(eq(factoryPhaseApprovals.appId, appId))
      .all();
    expect(rows).toEqual([
      expect.objectContaining({
        phase: "discovery",
        memberId: "user_pm",
        roleId: "project-manager",
      }),
      expect.objectContaining({ phase: "implementation" }),
    ]);
  });

  it("still records a machine-token approval from the bridge", async () => {
    signedIn("developer");
    const server = createFactoryHostBridgeServer({
      token: "machine-token",
      database,
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const address = server.address() as AddressInfo;
      const approved = await bridgeRequest(
        address.port,
        `/v1/apps/${appId}/phases/delivery/approve`,
      );
      expect(approved.status).toBe(200);
      expect(approved.body.approvedPhases).toEqual(["delivery"]);
      expect(database.select().from(factoryPhaseApprovals).all()).toEqual([
        expect.objectContaining({ phase: "delivery", memberId: "" }),
      ]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function bridgeRequest(port: number, path: string) {
  return new Promise<{ status: number; body: { approvedPhases: string[] } }>(
    (resolve, reject) => {
      const request = httpRequest(`http://127.0.0.1:${port}${path}`, {
        method: "POST",
        headers: { authorization: "Bearer machine-token" },
      });
      request.on("error", reject);
      request.on("response", (response) => {
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
      request.end();
    },
  );
}
