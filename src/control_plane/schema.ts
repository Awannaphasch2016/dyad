import {
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Shared store for private accounts and organizations.
 * This database is separate from the device SQLite cache.
 */
export const controlApps = pgTable(
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

export const controlChats = pgTable("chats", {
  id: text("id").primaryKey(),
  appId: text("app_id")
    .notNull()
    .references(() => controlApps.id, { onDelete: "cascade" }),
  title: text("title"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const controlMessages = pgTable("messages", {
  id: text("id").primaryKey(),
  chatId: text("chat_id")
    .notNull()
    .references(() => controlChats.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const controlKnowledgeItems = pgTable("knowledge_items", {
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

export const controlPhaseApprovals = pgTable(
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

export const controlPhaseComments = pgTable("phase_comments", {
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

export const controlAnswerLocks = pgTable("answer_locks", {
  chatId: text("chat_id")
    .primaryKey()
    .references(() => controlChats.id, { onDelete: "cascade" }),
  memberId: text("member_id").notNull(),
  memberName: text("member_name").notNull().default(""),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const controlAccountConnections = pgTable(
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

export const controlAuditEvents = pgTable("audit_events", {
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
