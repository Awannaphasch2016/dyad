CREATE SCHEMA IF NOT EXISTS "wewebplus";
--> statement-breakpoint
CREATE TABLE "wewebplus"."account_connections" (
	"owner_type" text NOT NULL,
	"owner_id" text NOT NULL,
	"provider" text NOT NULL,
	"ciphertext" text NOT NULL,
	"github_org" text,
	CONSTRAINT "account_connections_owner_type_owner_id_provider_pk" PRIMARY KEY("owner_type","owner_id","provider")
);
--> statement-breakpoint
CREATE TABLE "wewebplus"."answer_locks" (
	"chat_id" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"member_name" text DEFAULT '' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wewebplus"."apps" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"github_org" text,
	"github_repo" text,
	"github_branch" text,
	"supabase_project_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wewebplus"."audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wewebplus"."chats" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wewebplus"."knowledge_items" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"added_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wewebplus"."messages" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"ai_messages_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wewebplus"."phase_approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"phase" text NOT NULL,
	"member_id" text DEFAULT '' NOT NULL,
	"member_name" text DEFAULT '' NOT NULL,
	"role_id" text DEFAULT '' NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wewebplus"."phase_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"phase" text NOT NULL,
	"member_id" text DEFAULT '' NOT NULL,
	"member_name" text DEFAULT '' NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wewebplus"."answer_locks" ADD CONSTRAINT "answer_locks_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "wewebplus"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wewebplus"."chats" ADD CONSTRAINT "chats_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "wewebplus"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wewebplus"."knowledge_items" ADD CONSTRAINT "knowledge_items_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "wewebplus"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wewebplus"."messages" ADD CONSTRAINT "messages_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "wewebplus"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wewebplus"."phase_approvals" ADD CONSTRAINT "phase_approvals_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "wewebplus"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wewebplus"."phase_comments" ADD CONSTRAINT "phase_comments_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "wewebplus"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "apps_owner_idx" ON "wewebplus"."apps" USING btree ("owner_type","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "phase_approvals_app_phase_unique" ON "wewebplus"."phase_approvals" USING btree ("app_id","phase");