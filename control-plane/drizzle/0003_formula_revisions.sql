CREATE TABLE "wewebplus"."formula_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"phase" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "formula_revisions_phase_created_idx" ON "wewebplus"."formula_revisions" USING btree ("phase","created_at");