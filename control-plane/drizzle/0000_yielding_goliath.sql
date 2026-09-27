CREATE TABLE "account_connections" (
	"owner_type" text NOT NULL,
	"owner_id" text NOT NULL,
	"provider" text NOT NULL,
	"ciphertext" text NOT NULL,
	"github_org" text,
	CONSTRAINT "account_connections_owner_type_owner_id_provider_pk" PRIMARY KEY("owner_type","owner_id","provider")
);
--> statement-breakpoint
CREATE TABLE "answer_locks" (
	"chat_id" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"member_name" text DEFAULT '' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apps" (
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
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chats" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_items" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"added_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "phase_approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"phase" text NOT NULL,
	"member_id" text DEFAULT '' NOT NULL,
	"member_name" text DEFAULT '' NOT NULL,
	"role_id" text DEFAULT '' NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "phase_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"phase" text NOT NULL,
	"member_id" text DEFAULT '' NOT NULL,
	"member_name" text DEFAULT '' NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "answer_locks" ADD CONSTRAINT "answer_locks_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phase_approvals" ADD CONSTRAINT "phase_approvals_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phase_comments" ADD CONSTRAINT "phase_comments_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "apps_owner_idx" ON "apps" USING btree ("owner_type","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "phase_approvals_app_phase_unique" ON "phase_approvals" USING btree ("app_id","phase");