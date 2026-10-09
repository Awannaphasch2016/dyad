// Create the two dedicated walkthrough test accounts on the Development Clerk
// instance, add them to Wewebplus, and give them gate roles on the preview
// database. Idempotent. Prints ids and counts, never secret values.
//
// The two human accounts are not read for anything but the organization and
// are never modified or deleted.

import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { redact } from "./bolt-project.mjs";
import {
  DEVELOPER_EMAIL,
  PROJECT_MANAGER_EMAIL,
  clerkJson,
  clerkKeyKind,
  loadDirectory,
  neonQuery,
  safe,
} from "./bolt-sign-in.mjs";

// `+clerk_test` addresses never receive mail and are accepted by a Development
// instance in test mode. `example.com` is the domain Clerk documents for them.
export const TEST_ACCOUNTS = [
  {
    key: "pm",
    email: "walkthrough-pm+clerk_test@example.com",
    roleId: "project-manager",
    firstName: "Walkthrough",
    lastName: "Project Manager",
  },
  {
    key: "dev",
    email: "walkthrough-dev+clerk_test@example.com",
    roleId: "developer",
    firstName: "Walkthrough",
    lastName: "Developer",
  },
];

export function isClerkTestEmail(email) {
  return /\+clerk_test@/i.test(String(email ?? ""));
}

export function frontendApiHost(publishableKey) {
  const key = String(publishableKey ?? "");
  if (!key.startsWith("pk_test_")) return null;
  try {
    return Buffer.from(key.slice("pk_test_".length), "base64")
      .toString("utf8")
      .replace(/\$$/, "");
  } catch {
    return null;
  }
}

// What the Development instance lets a browser do without a person. Read from
// the public Frontend API environment document.
export function signInCapabilities(environment) {
  const auth = environment?.auth_config ?? {};
  const firstFactors = Array.isArray(auth.first_factors)
    ? auth.first_factors.map(String)
    : [];
  const attributes = environment?.user_settings?.attributes ?? {};
  return {
    instance: String(
      environment?.display_config?.instance_environment_type ?? "unknown",
    ),
    testMode: auth.test_mode === true,
    ticket: firstFactors.includes("ticket"),
    password:
      attributes.password?.enabled === true &&
      firstFactors.includes("password"),
    emailCode: firstFactors.includes("email_code"),
    emailAddress: attributes.email_address?.enabled === true,
    oauth: firstFactors.filter((item) => item.startsWith("oauth_")),
    captcha: environment?.user_settings?.sign_up?.captcha_enabled === true,
    secondFactorRequired:
      environment?.user_settings?.sign_in?.second_factor?.required === true,
  };
}

export function findWewebplus(organizations) {
  const matches = (organizations ?? []).filter(
    (org) => String(org.name ?? "").toLowerCase() === "wewebplus",
  );
  if (matches.length !== 1) return null;
  return { id: String(matches[0].id), name: String(matches[0].name) };
}

// Decide what to create and what to join. Pure, so the decision is testable
// without Clerk.
export function planTestAccounts({
  accounts,
  organization,
  memberCount,
  maxMemberships,
}) {
  if (!organization) throw new Error("Wewebplus organization was not found");
  const humans = new Set(
    [PROJECT_MANAGER_EMAIL, DEVELOPER_EMAIL].map((item) => item.toLowerCase()),
  );
  const plan = [];
  let joins = 0;
  for (const spec of TEST_ACCOUNTS) {
    const email = spec.email.toLowerCase();
    if (!isClerkTestEmail(email) || humans.has(email)) {
      throw new Error(`refusing to manage ${spec.key}: not a test address`);
    }
    const existing = (accounts ?? []).find((account) =>
      (account.emails ?? []).some(
        (item) => String(item).toLowerCase() === email,
      ),
    );
    const member = existing
      ? (existing.orgIds ?? []).includes(organization.id)
      : false;
    if (!member) joins += 1;
    plan.push({
      ...spec,
      userId: existing ? existing.id : null,
      create: !existing,
      joinOrg: !member,
    });
  }
  const limit = Number(maxMemberships) || 0;
  const current = Number(memberCount) || 0;
  if (limit > 0 && current + joins > limit) {
    throw new Error(
      `Wewebplus has ${current} of ${limit} memberships; ${joins} more would exceed the limit`,
    );
  }
  return plan;
}

export function testMembershipStatements({ organizationId, accounts }) {
  return accounts.map((account) => ({
    query:
      "insert into wewebplus.memberships (user_id, org_id, role_id) values ($1, $2, $3) on conflict (user_id, org_id) do update set role_id = excluded.role_id",
    params: [account.userId, organizationId, account.roleId],
  }));
}

export function outputLines(accounts, capabilities) {
  const lines = [];
  for (const account of accounts) {
    lines.push(`${account.key}_email=${account.email}`);
    lines.push(`${account.key}_user_id=${account.userId}`);
  }
  lines.push(`ticket_first_factor=${capabilities.ticket ? "on" : "off"}`);
  lines.push(`password_first_factor=${capabilities.password ? "on" : "off"}`);
  lines.push(
    `email_code_first_factor=${capabilities.emailCode ? "on" : "off"}`,
  );
  lines.push(
    `second_factor_required=${capabilities.secondFactorRequired ? "yes" : "no"}`,
  );
  return lines;
}

async function clerkPost(url, headers, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Clerk POST ${new URL(url).pathname} failed: ${response.status} ${safe(text)}`,
    );
  }
  return text ? JSON.parse(text) : {};
}

async function createUser(headers, spec) {
  const created = await clerkPost("https://api.clerk.com/v1/users", headers, {
    email_address: [spec.email],
    first_name: spec.firstName,
    last_name: spec.lastName,
    skip_password_requirement: true,
    skip_restriction_checks: true,
    public_metadata: {
      walkthrough_test: true,
      walkthrough_role: spec.roleId,
    },
  });
  return String(created.id);
}

async function joinOrganization(headers, organizationId, userId) {
  await clerkPost(
    `https://api.clerk.com/v1/organizations/${encodeURIComponent(organizationId)}/memberships`,
    headers,
    { user_id: userId, role: "org:member" },
  );
}

async function organizationCounts(headers, organizationId) {
  const org = await clerkJson(
    `https://api.clerk.com/v1/organizations/${encodeURIComponent(organizationId)}`,
    headers,
  );
  return {
    memberCount: Number(org.members_count ?? 0),
    maxMemberships: Number(org.max_allowed_memberships ?? 0),
  };
}

async function readCapabilities(publishable) {
  const host = frontendApiHost(publishable);
  if (!host) throw new Error("Preview Clerk key is not a development key");
  const response = await fetch(`https://${host}/v1/environment`);
  if (!response.ok) {
    throw new Error(`Clerk environment failed: ${response.status}`);
  }
  return signInCapabilities(await response.json());
}

export async function ensureTestAccounts() {
  const publishable = (process.env.CLERK_PUBLISHABLE_KEY ?? "").trim();
  const secret = (process.env.CLERK_SECRET_KEY ?? "").trim();
  const databaseUrl = (process.env.WEWEBPLUS_DATABASE_URL ?? "").trim();
  if (clerkKeyKind(publishable) !== "test" || clerkKeyKind(secret) !== "test") {
    throw new Error("Preview Clerk key is not a development key");
  }
  if (!databaseUrl) throw new Error("Question store is unavailable.");
  const headers = { Authorization: `Bearer ${secret}` };

  const capabilities = await readCapabilities(publishable);
  console.log(
    `clerk_instance=${capabilities.instance} test_mode=${capabilities.testMode ? "on" : "off"} oauth=${capabilities.oauth.join(",") || "none"} captcha=${capabilities.captcha ? "on" : "off"}`,
  );
  if (capabilities.instance !== "development") {
    throw new Error("Clerk instance is not a development instance");
  }

  const directory = await loadDirectory(secret);
  const organization = findWewebplus(directory.organizations);
  if (!organization) throw new Error("Wewebplus organization was not found");
  const counts = await organizationCounts(headers, organization.id);
  const plan = planTestAccounts({
    accounts: directory.accounts,
    organization,
    ...counts,
  });

  let created = 0;
  let joined = 0;
  for (const account of plan) {
    if (account.create) {
      account.userId = await createUser(headers, account);
      created += 1;
    }
    if (account.joinOrg) {
      await joinOrganization(headers, organization.id, account.userId);
      joined += 1;
    }
  }
  for (const statement of testMembershipStatements({
    organizationId: organization.id,
    accounts: plan,
  })) {
    await neonQuery(databaseUrl, statement.query, statement.params);
  }
  const after = await organizationCounts(headers, organization.id);
  console.log(
    `org=${organization.name} created=${created} joined=${joined} clerk_members=${after.memberCount}/${after.maxMemberships} db_memberships=${plan.length}`,
  );
  const lines = outputLines(plan, capabilities);
  for (const line of lines) console.log(line);
  const outputFile = process.env.GITHUB_OUTPUT ?? "";
  if (outputFile) {
    appendFileSync(outputFile, `${lines.join("\n")}\n`);
  }
  console.log(
    `roles=${plan.map((account) => `${account.key}:${account.roleId}`).join(" ")}`,
  );
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  ensureTestAccounts().catch((error) => {
    console.log(redact(error?.message || error));
    process.exit(1);
  });
}
