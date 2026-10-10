import fs from "node:fs";
import path from "node:path";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import log from "electron-log";
import postgres from "postgres";
import { migrationBaselineWhen } from "./migration_baseline";
import { repairStatements } from "./repair_sql";
import * as schema from "./schema";

const logger = log.scope("control_plane_sync");

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

function asPresent(value: unknown): boolean {
  return value === true || value === "t" || value === "true" || value === 1;
}

async function relationPresent(
  client: postgres.Sql,
  table: string,
): Promise<boolean> {
  const rows = await client<{ present: unknown }[]>`
    select exists (
      select 1
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'wewebplus'
        and c.relname = ${table}
        and c.relkind in ('r', 'p')
    ) as present
  `;
  return asPresent(rows[0]?.present);
}

async function columnPresent(
  client: postgres.Sql,
  table: string,
  column: string,
): Promise<boolean> {
  const rows = await client<{ present: unknown }[]>`
    select exists (
      select 1
      from pg_catalog.pg_attribute a
      join pg_catalog.pg_class c on c.oid = a.attrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'wewebplus'
        and c.relname = ${table}
        and a.attname = ${column}
        and a.attnum > 0
        and not a.attisdropped
    ) as present
  `;
  return asPresent(rows[0]?.present);
}

async function probePresent(
  client: postgres.Sql,
  tag: string,
): Promise<boolean | null> {
  if (tag === "0000_control_plane") {
    const apps = await relationPresent(client, "apps");
    const knowledge = await relationPresent(client, "knowledge_items");
    return apps && knowledge;
  }
  if (tag === "0001_hitl") return relationPresent(client, "roles");
  if (tag === "0002_gate_resolved_at") {
    return columnPresent(client, "answers", "gate_resolved_at");
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
  logger.info(
    `control_plane_baseline apps=${present["0000_control_plane"] === true} roles=${present["0001_hitl"] === true} gate=${present["0002_gate_resolved_at"] === true} stamp=${stamp ?? "none"}`,
  );
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

function alreadyExists(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("already exists");
}

async function repairExistingSchema(client: postgres.Sql): Promise<void> {
  const files = fs
    .readdirSync(migrationsFolder)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  let count = 0;
  for (const name of files) {
    const text = fs.readFileSync(path.join(migrationsFolder, name), "utf8");
    for (const statement of repairStatements(text)) {
      await client.unsafe(statement);
      count += 1;
    }
  }
  logger.info(`control_plane_repair statements=${count}`);
}

async function openControlPlane(): Promise<ControlPlaneDb> {
  const client = postgres(process.env.WEWEBPLUS_DATABASE_URL!, { max: 4 });
  await client`CREATE SCHEMA IF NOT EXISTS wewebplus`;
  await repairExistingSchema(client);
  await baselineExistingSchema(client);
  const db = drizzlePostgres(client, { schema });
  try {
    await migratePostgres(db, { migrationsFolder });
  } catch (error) {
    if (!alreadyExists(error)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`control_plane_migrate retry after ${message.split("\n")[0]}`);
    await baselineExistingSchema(client);
    await migratePostgres(db, { migrationsFolder });
  }
  const { seedWewebplusMemberships } = await import("./hitl_store");
  await seedWewebplusMemberships(db);
  cached = db;
  return db;
}

export function setControlPlaneDbForTesting(db: ControlPlaneDb | null): void {
  cached = db;
  ready = db ? Promise.resolve(db) : null;
}
