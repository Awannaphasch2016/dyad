CREATE TABLE "wewebplus"."roles" (
	"org_id" text NOT NULL,
	"role_id" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "roles_org_id_role_id_pk" PRIMARY KEY("org_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "wewebplus"."memberships" (
	"user_id" text NOT NULL,
	"org_id" text NOT NULL,
	"role_id" text NOT NULL,
	CONSTRAINT "memberships_user_id_org_id_pk" PRIMARY KEY("user_id","org_id")
);
--> statement-breakpoint
CREATE TABLE "wewebplus"."questions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"app_id" text NOT NULL,
	"phase" text NOT NULL,
	"chat_id" text,
	"run_id" text NOT NULL,
	"step_id" text NOT NULL,
	"target_role_id" text NOT NULL,
	"visibility" text DEFAULT 'role' NOT NULL,
	"status" text NOT NULL,
	"body" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"bead_id" text,
	"answered_by_user_id" text,
	"answered_by_name" text,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "questions_idempotency_unique" ON "wewebplus"."questions" USING btree ("org_id","idempotency_key");--> statement-breakpoint
CREATE TABLE "wewebplus"."answers" (
	"id" text PRIMARY KEY NOT NULL,
	"question_id" text NOT NULL,
	"user_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wewebplus"."answers" ADD CONSTRAINT "answers_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "wewebplus"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "answers_question_unique" ON "wewebplus"."answers" USING btree ("question_id");--> statement-breakpoint
INSERT INTO "wewebplus"."roles" ("org_id", "role_id", "name") VALUES
	('org_3JuOz4PCITqmueMeKYhcFUXAEIH', 'project-manager', 'Project Manager'),
	('org_3JuOz4PCITqmueMeKYhcFUXAEIH', 'developer', 'Developer')
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "wewebplus"."memberships" ("user_id", "org_id", "role_id") VALUES
	('user_3Jo9AXjywP5QJtRbqTWJTn5sdxN', 'org_3JuOz4PCITqmueMeKYhcFUXAEIH', 'project-manager'),
	('user_3K58joknYZ90Fts4yQC6yq4Enay', 'org_3JuOz4PCITqmueMeKYhcFUXAEIH', 'developer')
ON CONFLICT DO NOTHING;
