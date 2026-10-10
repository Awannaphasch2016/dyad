import { describe, expect, it } from "vitest";
import { repairStatements } from "./repair_sql";

const sample = `
CREATE TABLE "wewebplus"."knowledge_items" (
  "id" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wewebplus"."knowledge_items" ADD CONSTRAINT "knowledge_items_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "wewebplus"."apps"("id");
--> statement-breakpoint
CREATE INDEX "apps_owner_idx" ON "wewebplus"."apps" USING btree ("owner_type","owner_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "phase_approvals_app_phase_unique" ON "wewebplus"."phase_approvals" USING btree ("app_id","phase");
--> statement-breakpoint
ALTER TABLE "wewebplus"."answers" ADD COLUMN IF NOT EXISTS "gate_resolved_at" timestamp with time zone;
--> statement-breakpoint
INSERT INTO "wewebplus"."roles" ("org_id") VALUES ('org') ON CONFLICT DO NOTHING;
`;

describe("repairStatements", () => {
  it("creates missing tables and indexes without repeating foreign keys", () => {
    const statements = repairStatements(sample);
    expect(
      statements.some((statement) =>
        statement.startsWith("CREATE TABLE IF NOT EXISTS"),
      ),
    ).toBe(true);
    expect(
      statements.some((statement) => statement.includes("knowledge_items")),
    ).toBe(true);
    expect(
      statements.some((statement) =>
        statement.startsWith("CREATE INDEX IF NOT EXISTS"),
      ),
    ).toBe(true);
    expect(
      statements.some((statement) =>
        statement.startsWith("CREATE UNIQUE INDEX IF NOT EXISTS"),
      ),
    ).toBe(true);
    expect(
      statements.some((statement) =>
        statement.includes("ADD COLUMN IF NOT EXISTS"),
      ),
    ).toBe(true);
    expect(
      statements.some((statement) => statement.startsWith("INSERT INTO")),
    ).toBe(true);
    expect(
      statements.some((statement) => statement.includes("ADD CONSTRAINT")),
    ).toBe(false);
  });
});
