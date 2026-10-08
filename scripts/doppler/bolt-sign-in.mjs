// Seed Wewebplus gate roles on the preview database and allow the walkthrough
// origin on the Development Clerk instance. Does not print secret values.

import { pathToFileURL } from "node:url";
import { redact } from "./bolt-project.mjs";

export const WALKTHROUGH_ORIGIN =
  "https://bolt-walkthrough-55d6.karant-test-egress-canary.workers.dev";
export const WALKTHROUGH_APP_ID = "bolt-walkthrough";
export const PROJECT_MANAGER_EMAIL = "anakwannaphaschaiyong@gmail.com";
export const DEVELOPER_EMAIL = "awannaphasch2016@fau.edu";

export const WALKTHROUGH_QUESTIONS = [
  {
    phase: "discovery",
    stepId: "plan-approve",
    roleId: "project-manager",
    body: "Approve the Discovery plan.",
  },
  {
    phase: "implementation",
    stepId: "review-approve-dev",
    roleId: "developer",
    body: "Approve the Implementation review.",
  },
  {
    phase: "delivery",
    stepId: "review-approve-pm",
    roleId: "project-manager",
    body: "Approve the Delivery review.",
  },
];

const SCHEMA = [
  "create schema if not exists wewebplus",
  `create table if not exists wewebplus.roles (
    org_id text not null,
    role_id text not null,
    name text not null,
    primary key (org_id, role_id)
  )`,
  `create table if not exists wewebplus.memberships (
    user_id text not null,
    org_id text not null,
    role_id text not null,
    primary key (user_id, org_id)
  )`,
  `create table if not exists wewebplus.apps (
    id text primary key not null,
    owner_type text not null,
    owner_id text not null,
    name text not null,
    slug text not null,
    github_org text,
    github_repo text,
    github_branch text,
    supabase_project_id text,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists wewebplus.questions (
    id text primary key not null,
    org_id text not null,
    app_id text not null,
    phase text not null,
    chat_id text,
    run_id text not null,
    step_id text not null,
    target_role_id text not null,
    visibility text not null default 'role',
    status text not null,
    body text not null,
    idempotency_key text not null,
    created_at timestamptz not null default now(),
    bead_id text,
    answered_by_user_id text,
    answered_by_name text,
    answered_at timestamptz
  )`,
  "create unique index if not exists questions_idempotency_unique on wewebplus.questions (org_id, idempotency_key)",
  `create table if not exists wewebplus.answers (
    id text primary key not null,
    question_id text not null references wewebplus.questions (id) on delete cascade,
    user_id text not null,
    body text not null,
    created_at timestamptz not null default now(),
    gate_resolved_at timestamptz
  )`,
  "create unique index if not exists answers_question_unique on wewebplus.answers (question_id)",
  "alter table wewebplus.answers add column if not exists gate_resolved_at timestamptz",
];

export function clerkKeyKind(value) {
  const key = String(value ?? "").trim();
  if (key.startsWith("pk_test_") || key.startsWith("sk_test_")) return "test";
  if (key.startsWith("pk_live_") || key.startsWith("sk_live_")) return "live";
  if (!key) return "absent";
  return "other";
}

export function matchGateAccounts(users) {
  const normalized = (users ?? []).map((user) => ({
    id: String(user.id),
    emails: (user.emails ?? []).map((email) => String(email).toLowerCase()),
    providers: [...(user.providers ?? [])],
    orgIds: (user.orgIds ?? []).map(String),
  }));
  const byEmail = (email) =>
    normalized.find((user) => user.emails.includes(email.toLowerCase())) ??
    null;
  const projectManager = byEmail(PROJECT_MANAGER_EMAIL);
  let developer = byEmail(DEVELOPER_EMAIL);
  if (!developer) {
    const microsoft = normalized.filter((user) =>
      user.providers.includes("oauth_microsoft"),
    );
    if (microsoft.length === 1) developer = microsoft[0];
  }
  return { projectManager, developer };
}

export function sharedOrganization(projectManager, developer, organizations) {
  if (!projectManager || !developer) return null;
  const shared = projectManager.orgIds.filter((id) =>
    developer.orgIds.includes(id),
  );
  if (shared.length !== 1) return null;
  const org = (organizations ?? []).find((item) => item.id === shared[0]);
  if (!org || String(org.name).toLowerCase() !== "wewebplus") return null;
  return { id: String(org.id), name: String(org.name) };
}

export function originsWithWalkthrough(existing) {
  const origins = [];
  for (const item of existing ?? []) {
    if (typeof item !== "string" || item.length === 0) continue;
    if (!origins.includes(item)) origins.push(item);
  }
  if (origins.includes(WALKTHROUGH_ORIGIN)) {
    return { origins, added: false };
  }
  return { origins: [...origins, WALKTHROUGH_ORIGIN], added: true };
}

export function membershipSeedStatements({
  organizationId,
  projectManagerId,
  developerId,
}) {
  const statements = SCHEMA.map((query) => ({ query, params: [] }));
  statements.push(
    {
      query:
        "insert into wewebplus.roles (org_id, role_id, name) values ($1, 'project-manager', 'Project Manager') on conflict (org_id, role_id) do nothing",
      params: [organizationId],
    },
    {
      query:
        "insert into wewebplus.roles (org_id, role_id, name) values ($1, 'developer', 'Developer') on conflict (org_id, role_id) do nothing",
      params: [organizationId],
    },
    {
      query:
        "insert into wewebplus.memberships (user_id, org_id, role_id) values ($1, $2, 'project-manager') on conflict (user_id, org_id) do update set role_id = excluded.role_id",
      params: [projectManagerId, organizationId],
    },
    {
      query:
        "insert into wewebplus.memberships (user_id, org_id, role_id) values ($1, $2, 'developer') on conflict (user_id, org_id) do update set role_id = excluded.role_id",
      params: [developerId, organizationId],
    },
    {
      query:
        "insert into wewebplus.apps (id, owner_type, owner_id, name, slug) values ($1, 'org', $2, 'Bolt walkthrough', $1) on conflict (id) do nothing",
      params: [WALKTHROUGH_APP_ID, organizationId],
    },
  );
  for (const question of WALKTHROUGH_QUESTIONS) {
    const id = `${WALKTHROUGH_APP_ID}:${question.phase}:${question.stepId}`;
    statements.push({
      query:
        "insert into wewebplus.questions (id, org_id, app_id, phase, run_id, step_id, target_role_id, visibility, status, body, idempotency_key) values ($1, $2, $3, $4, $3, $5, $6, 'role', 'open', $7, $1) on conflict (org_id, idempotency_key) do nothing",
      params: [
        id,
        organizationId,
        WALKTHROUGH_APP_ID,
        question.phase,
        question.stepId,
        question.roleId,
        question.body,
      ],
    });
  }
  return statements;
}

function safe(text) {
  return redact(text).replace(
    /\b(?:pk|sk)_(?:test|live)_[A-Za-z0-9+/=_-]+/g,
    "clerk_redacted",
  );
}

function asList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

async function clerkJson(url, headers) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Clerk request failed: ${response.status}`);
  }
  return response.json();
}

async function loadDirectory(secret) {
  const headers = { Authorization: `Bearer ${secret}` };
  const users = [];
  for (let offset = 0; offset < 500; offset += 100) {
    const page = asList(
      await clerkJson(
        `https://api.clerk.com/v1/users?limit=100&offset=${offset}`,
        headers,
      ),
    );
    users.push(...page);
    if (page.length < 100) break;
  }
  const organizations = asList(
    await clerkJson(
      "https://api.clerk.com/v1/organizations?limit=100",
      headers,
    ),
  ).map((org) => ({ id: String(org.id), name: String(org.name ?? "") }));
  const accounts = [];
  for (const user of users) {
    const memberships = asList(
      await clerkJson(
        `https://api.clerk.com/v1/users/${encodeURIComponent(user.id)}/organization_memberships?limit=100`,
        headers,
      ),
    );
    accounts.push({
      id: String(user.id),
      emails: (user.email_addresses ?? [])
        .map((item) => item.email_address)
        .filter(Boolean),
      providers: (user.external_accounts ?? [])
        .map((item) => item.provider)
        .filter(Boolean),
      orgIds: memberships.map((row) => row.organization?.id).filter(Boolean),
    });
  }
  return { accounts, organizations };
}

async function neonQuery(databaseUrl, query, params) {
  const endpoint = new URL(databaseUrl);
  const response = await fetch(`https://${endpoint.host}/sql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Neon-Connection-String": databaseUrl,
    },
    body: JSON.stringify({ query, params }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Question store ${response.status} ${safe(text)}`);
  }
}

async function allowWalkthroughOrigin(secret) {
  const headers = {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
  };
  const current = await fetch("https://api.clerk.com/v1/instance", { headers });
  if (!current.ok) {
    throw new Error(`Clerk read failed: ${current.status}`);
  }
  const body = await current.json();
  const next = originsWithWalkthrough(body.allowed_origins);
  if (!next.added) {
    console.log("clerk_origin=already");
    return;
  }
  const updated = await fetch("https://api.clerk.com/v1/instance", {
    method: "PATCH",
    headers,
    body: JSON.stringify({ allowed_origins: next.origins }),
  });
  if (updated.status !== 200 && updated.status !== 204) {
    throw new Error(`Clerk update failed: ${updated.status}`);
  }
  console.log("clerk_origin=added");
}

export async function seedBoltSignIn() {
  const publishable = process.env.CLERK_PUBLISHABLE_KEY ?? "";
  const secret = process.env.CLERK_SECRET_KEY ?? "";
  const databaseUrl = process.env.WEWEBPLUS_DATABASE_URL ?? "";
  const publishableKind = clerkKeyKind(publishable);
  const secretKind = clerkKeyKind(secret);
  console.log(
    `clerk_publishable=${publishableKind === "test" ? "pk_test" : publishableKind === "live" ? "pk_live" : publishableKind}`,
  );
  console.log(
    `clerk_secret=${secretKind === "test" ? "sk_test" : secretKind === "live" ? "sk_live" : secretKind}`,
  );
  if (publishableKind !== "test" || secretKind !== "test") {
    throw new Error("Preview Clerk key is not a development key");
  }
  if (!databaseUrl.trim()) {
    throw new Error("Question store is unavailable.");
  }
  const directory = await loadDirectory(secret.trim());
  const matched = matchGateAccounts(directory.accounts);
  if (!matched.projectManager || !matched.developer) {
    console.log(
      `project-manager=${matched.projectManager ? "present" : "absent"} developer=${matched.developer ? "present" : "absent"}`,
    );
    throw new Error("Wewebplus sign-in accounts were not found");
  }
  const organization = sharedOrganization(
    matched.projectManager,
    matched.developer,
    directory.organizations,
  );
  if (!organization) {
    throw new Error("Wewebplus organization was not found");
  }
  console.log("org=Wewebplus project-manager=present developer=present");
  const statements = membershipSeedStatements({
    organizationId: organization.id,
    projectManagerId: matched.projectManager.id,
    developerId: matched.developer.id,
  });
  for (const statement of statements) {
    await neonQuery(databaseUrl.trim(), statement.query, statement.params);
  }
  console.log(`memberships=2 questions=${WALKTHROUGH_QUESTIONS.length}`);
  await allowWalkthroughOrigin(secret.trim());
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  seedBoltSignIn().catch((error) => {
    console.log(safe(error?.message || error));
    process.exit(1);
  });
}
