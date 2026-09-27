import {
  index,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Shared store for private accounts and organizations.
 * Tables live in their own schema so they do not collide with other tables
 * in the same Postgres database. This database is separate from the device
 * SQLite cache.
 */
const controlPlane = pgSchema("wewebplus");

export const controlApps = controlPlane.table(
  "apps",
  {
    id: text("id").primaryKey(),
    ownerType: text("owner_type").notNull(),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    githubOrg: text("github_org"),
    githubRepo: text("github_repo"),
    githubBranch: text("github_branch"),
    supabaseProjectId: text("supabase_project_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("apps_owner_idx").on(table.ownerType, table.ownerId)],
);

export const controlChats = controlPlane.table("chats", {
  id: text("id").primaryKey(),
  appId: text("app_id")
    .notNull()
    .references(() => controlApps.id, { onDelete: "cascade" }),
  title: text("title"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const controlMessages = controlPlane.table("messages", {
  id: text("id").primaryKey(),
  chatId: text("chat_id")
    .notNull()
    .references(() => controlChats.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  aiMessagesJson: jsonb("ai_messages_json"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const controlKnowledgeItems = controlPlane.table("knowledge_items", {
  id: text("id").primaryKey(),
  appId: text("app_id")
    .notNull()
    .references(() => controlApps.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  url: text("url").notNull(),
  addedBy: text("added_by").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const controlPhaseApprovals = controlPlane.table(
  "phase_approvals",
  {
    id: text("id").primaryKey(),
    appId: text("app_id")
      .notNull()
      .references(() => controlApps.id, { onDelete: "cascade" }),
    phase: text("phase").notNull(),
    memberId: text("member_id").notNull().default(""),
    memberName: text("member_name").notNull().default(""),
    roleId: text("role_id").notNull().default(""),
    approvedAt: timestamp("approved_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("phase_approvals_app_phase_unique").on(
      table.appId,
      table.phase,
    ),
  ],
);

export const controlPhaseComments = controlPlane.table("phase_comments", {
  id: text("id").primaryKey(),
  appId: text("app_id")
    .notNull()
    .references(() => controlApps.id, { onDelete: "cascade" }),
  phase: text("phase").notNull(),
  memberId: text("member_id").notNull().default(""),
  memberName: text("member_name").notNull().default(""),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const controlAnswerLocks = controlPlane.table("answer_locks", {
  chatId: text("chat_id")
    .primaryKey()
    .references(() => controlChats.id, { onDelete: "cascade" }),
  memberId: text("member_id").notNull(),
  memberName: text("member_name").notNull().default(""),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const controlAccountConnections = controlPlane.table(
  "account_connections",
  {
    ownerType: text("owner_type").notNull(),
    ownerId: text("owner_id").notNull(),
    provider: text("provider").notNull(),
    ciphertext: text("ciphertext").notNull(),
    githubOrg: text("github_org"),
  },
  (table) => [
    primaryKey({
      columns: [table.ownerType, table.ownerId, table.provider],
    }),
  ],
);

export const controlAuditEvents = controlPlane.table("audit_events", {
  id: text("id").primaryKey(),
  ownerType: text("owner_type").notNull(),
  ownerId: text("owner_id").notNull(),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  subject: text("subject").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
