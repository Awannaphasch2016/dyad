import path from "node:path";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
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
  const db = drizzlePostgres(client, { schema });
  await migratePostgres(db, { migrationsFolder });
  cached = db;
  return db;
}

export function setControlPlaneDbForTesting(db: ControlPlaneDb | null): void {
  cached = db;
  ready = db ? Promise.resolve(db) : null;
}
