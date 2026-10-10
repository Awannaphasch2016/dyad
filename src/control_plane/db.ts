import fs from "node:fs";
import path from "node:path";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { migrationBaselineWhen } from "./migration_baseline";
import * as schema from "./schema";

export type ControlPlaneDb = ReturnType<typeof drizzlePostgres<typeof schema>>;

let cached: ControlPlaneDb | null = null;
let ready: Promise<ControlPlaneDb | null> | null = null;

const migrationsFolder = path.join(process.cwd(), "control-plane/drizzle");

export function controlPlaneConfigured(): boolean {
  return Boolean(process.env.WEWEBPLUS_DATABASE_URL?.trim());
}

export async function getControlPlaneDb(): Promise<ControlPlaneDb | null> {
  if (!controlPlaneConfigured()) return null;
  if (cached) return cached;
  if (!ready) {
    ready = openControlPlane().catch((error) => {
      ready = null;
      throw error;
    });
  }
  return ready;
}

async function probePresent(
  client: postgres.Sql,
  tag: string,
): Promise<boolean | null> {
  if (tag === "0000_control_plane") {
    const rows = await client<{ present: boolean }[]>`
      select exists (
        select 1 from information_schema.tables
        where table_schema = 'wewebplus' and table_name = 'apps'
      ) as present
    `;
    return Boolean(rows[0]?.present);
  }
  if (tag === "0001_hitl") {
    const rows = await client<{ present: boolean }[]>`
      select exists (
        select 1 from information_schema.tables
        where table_schema = 'wewebplus' and table_name = 'roles'
      ) as present
    `;
    return Boolean(rows[0]?.present);
  }
  if (tag === "0002_gate_resolved_at") {
    const rows = await client<{ present: boolean }[]>`
      select exists (
        select 1 from information_schema.columns
        where table_schema = 'wewebplus'
          and table_name = 'answers'
          and column_name = 'gate_resolved_at'
      ) as present
    `;
    return Boolean(rows[0]?.present);
  }
  return null;
}

async function baselineExistingSchema(client: postgres.Sql): Promise<void> {
  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as {
    entries: { tag: string; when: number }[];
  };
  const present: Record<string, boolean> = {};
  for (const entry of journal.entries) {
    const probed = await probePresent(client, entry.tag);
    if (probed == null || !probed) break;
    present[entry.tag] = true;
  }
  const stamp = migrationBaselineWhen(journal.entries, present);
  if (stamp == null) return;

  await client`CREATE SCHEMA IF NOT EXISTS drizzle`;
  await client`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `;
  const rows = await client<{ created_at: string | number | null }[]>`
    select created_at from drizzle.__drizzle_migrations
    order by created_at desc
    limit 1
  `;
  const latest = rows[0] ? Number(rows[0].created_at) : 0;
  if (Number.isFinite(latest) && latest >= stamp) return;
  await client`
    insert into drizzle.__drizzle_migrations (hash, created_at)
    values ('baseline', ${stamp})
  `;
}

async function openControlPlane(): Promise<ControlPlaneDb> {
  const client = postgres(process.env.WEWEBPLUS_DATABASE_URL!, { max: 4 });
  await client`CREATE SCHEMA IF NOT EXISTS wewebplus`;
  await baselineExistingSchema(client);
  const db = drizzlePostgres(client, { schema });
  await migratePostgres(db, { migrationsFolder });
  const { seedWewebplusMemberships } = await import("./hitl_store");
  await seedWewebplusMemberships(db);
  cached = db;
  return db;
}

export function setControlPlaneDbForTesting(db: ControlPlaneDb | null): void {
  cached = db;
  ready = db ? Promise.resolve(db) : null;
}
