/**
 * The live database has some wewebplus tables and is missing others.
 * Drizzle will not re-run a migration whose timestamp is already recorded,
 * and re-running it fails on the tables that do exist. These statements are
 * the migration SQL with creation made idempotent, and foreign-key alters
 * removed because those fail when the constraint is already there.
 */
export function repairStatements(sqlText: string): string[] {
  return sqlText
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
    .filter(
      (statement) =>
        !/^ALTER TABLE\b[\s\S]*\bADD CONSTRAINT\b/i.test(statement),
    )
    .map((statement) =>
      statement
        .replace(/^CREATE TABLE /i, "CREATE TABLE IF NOT EXISTS ")
        .replace(/^CREATE UNIQUE INDEX /i, "CREATE UNIQUE INDEX IF NOT EXISTS ")
        .replace(/^CREATE INDEX /i, "CREATE INDEX IF NOT EXISTS "),
    );
}
