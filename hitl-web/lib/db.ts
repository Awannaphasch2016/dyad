import postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

const globalForSql = globalThis as unknown as { hitlSql?: Sql };

export function databaseConfigured(): boolean {
  return Boolean(process.env.WEWEBPLUS_DATABASE_URL?.trim());
}

export function getSql(): Sql | null {
  const url = process.env.WEWEBPLUS_DATABASE_URL?.trim();
  if (!url) return null;
  if (!globalForSql.hitlSql) {
    const local = /localhost|127\.0\.0\.1/.test(url);
    globalForSql.hitlSql = postgres(url, {
      max: 1,
      prepare: false,
      ssl: local ? false : "require",
    });
  }
  return globalForSql.hitlSql;
}
