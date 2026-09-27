import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it } from "vitest";
import type { ControlPlaneDb } from "./db";
import { insertControlApp, listControlApps } from "./repository";
import * as schema from "./schema";

describe("control plane apps", () => {
  it("keeps a private app off another user's list and shares an organization app", async () => {
    const client = new PGlite();
    const plane = drizzle(client, { schema });
    await migrate(plane, { migrationsFolder: "control-plane/drizzle" });
    const db = plane as unknown as ControlPlaneDb;
    await insertControlApp(db, {
      id: "app-private",
      owner: { type: "user", id: "user_a" },
      name: "Private page",
      slug: "private-page",
      githubOrg: null,
      githubRepo: null,
      githubBranch: null,
      supabaseProjectId: null,
    });
    await insertControlApp(db, {
      id: "app-shared",
      owner: { type: "org", id: "org_1" },
      name: "Shared page",
      slug: "shared-page",
      githubOrg: "bakery",
      githubRepo: "shared",
      githubBranch: "main",
      supabaseProjectId: null,
    });

    const ada = await listControlApps(db, { type: "user", id: "user_a" });
    const other = await listControlApps(db, { type: "user", id: "user_b" });
    const org = await listControlApps(db, { type: "org", id: "org_1" });

    expect(ada.map((app) => app.name)).toEqual(["Private page"]);
    expect(other).toEqual([]);
    expect(org.map((app) => app.name)).toEqual(["Shared page"]);
  });
});
