import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { controlPlaneStampTags } from "./control_plane_baseline";
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

async function openControlPlane(): Promise<ControlPlaneDb> {
  const client = postgres(process.env.WEWEBPLUS_DATABASE_URL!, { max: 4 });
  await client`CREATE SCHEMA IF NOT EXISTS wewebplus`;
  await stampExistingControlPlane(client);
  const db = drizzlePostgres(client, { schema });
  await migratePostgres(db, { migrationsFolder });
  const { seedWewebplusMemberships } = await import("./hitl_store");
  await seedWewebplusMemberships(db);
  cached = db;
  return db;
}

type MigrationJournal = {
  entries: Array<{ tag: string; when: number }>;
};

async function relationExists(
  client: postgres.Sql,
  table: string,
): Promise<boolean> {
  const rows = await client<{ found: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'wewebplus' AND table_name = ${table}
    ) AS found
  `;
  return rows[0]?.found === true;
}

async function stampExistingControlPlane(client: postgres.Sql): Promise<void> {
  const gate = await client<{ found: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'wewebplus'
        AND table_name = 'answers'
        AND column_name = 'gate_resolved_at'
    ) AS found
  `;
  const tags = controlPlaneStampTags({
    apps: await relationExists(client, "apps"),
    roles: await relationExists(client, "roles"),
    gateResolvedAt: gate[0]?.found === true,
    formulaRevisions: await relationExists(client, "formula_revisions"),
  });
  if (tags.length === 0) return;

  const journal = JSON.parse(
    fs.readFileSync(path.join(migrationsFolder, "meta/_journal.json"), "utf8"),
  ) as MigrationJournal;
  await client`CREATE SCHEMA IF NOT EXISTS drizzle`;
  await client`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `;
  const latest = await client<{ created_at: string | number | null }[]>`
    SELECT created_at FROM drizzle.__drizzle_migrations
    ORDER BY created_at DESC
    LIMIT 1
  `;
  let applied =
    latest[0]?.created_at == null ? 0 : Number(latest[0].created_at);
  const pending = new Set(tags);
  for (const entry of journal.entries) {
    if (!pending.has(entry.tag) || entry.when <= applied) continue;
    const query = fs.readFileSync(
      path.join(migrationsFolder, `${entry.tag}.sql`),
      "utf8",
    );
    const hash = crypto.createHash("sha256").update(query).digest("hex");
    await client`
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
      VALUES (${hash}, ${entry.when})
    `;
    applied = entry.when;
  }
}

export function setControlPlaneDbForTesting(db: ControlPlaneDb | null): void {
  cached = db;
  ready = db ? Promise.resolve(db) : null;
}
