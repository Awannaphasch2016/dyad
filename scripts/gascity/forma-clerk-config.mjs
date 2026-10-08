// Confirm Forma dev has the shared sign-in names. Missing names become
// Doppler references to dyad/preview. Values are never printed.

import { pathToFileURL } from "node:url";

export const FORMA_PROJECT = "forma";
export const FORMA_CONFIG = "dev";
export const SHARED_SOURCE = { project: "dyad", config: "preview" };

export const SHARED_SIGN_IN_NAMES = [
  "CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "WEWEBPLUS_DATABASE_URL",
];

export function clerkKeyKind(value) {
  const key = String(value ?? "").trim();
  if (key.startsWith("pk_test_") || key.startsWith("sk_test_")) return "test";
  if (key.startsWith("pk_live_") || key.startsWith("sk_live_")) return "live";
  if (!key) return "absent";
  return "other";
}

export function referenceString(project, config, name) {
  return `\${${project}.${config}.${name}}`;
}

export function clerkReferencePlan(names) {
  const present = new Set(names ?? []);
  const secrets = {};
  for (const name of SHARED_SIGN_IN_NAMES) {
    if (present.has(name)) continue;
    secrets[name] = referenceString(
      SHARED_SOURCE.project,
      SHARED_SOURCE.config,
      name,
    );
  }
  return secrets;
}

export function assertDevelopmentClerk(publishableKind, secretKind) {
  if (publishableKind === "live" || secretKind === "live") {
    throw new Error("Refusing a live Clerk key");
  }
}

export function neonSqlHost(databaseUrl) {
  const endpoint = new URL(databaseUrl);
  if (
    endpoint.protocol !== "postgresql:" &&
    endpoint.protocol !== "postgres:"
  ) {
    throw new Error("Membership store is unavailable.");
  }
  return endpoint.hostname.replace("-pooler.", ".");
}

export function membershipRoleSummary(rows) {
  const counts = new Map();
  for (const row of rows ?? []) {
    const role = String(row.role_id ?? "");
    if (role !== "project-manager" && role !== "developer") continue;
    counts.set(role, (counts.get(role) ?? 0) + Number(row.n ?? 1));
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([role, count]) => `${role}:${count}`)
    .join(",");
}

export function redact(value) {
  return String(value ?? "")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://redacted")
    .replace(/\b(?:pk|sk)_(?:test|live)_[A-Za-z0-9_]+/g, "clerk_redacted")
    .replace(/dp\.(?:st|pt|sa|ct)\/\S+/g, "doppler_redacted");
}

function secretNames(downloaded) {
  if (
    !downloaded ||
    typeof downloaded !== "object" ||
    Array.isArray(downloaded)
  ) {
    return [];
  }
  return Object.keys(downloaded).sort();
}

async function doppler(token, method, path, body) {
  const response = await fetch(`https://api.doppler.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `doppler ${method} ${path.split("?")[0]} ${response.status} ${redact(text).slice(0, 180)}`,
    );
  }
  return text ? JSON.parse(text) : {};
}

async function download(token) {
  return doppler(
    token,
    "GET",
    `/v3/configs/config/secrets/download?project=${FORMA_PROJECT}&config=${FORMA_CONFIG}&format=json`,
  );
}

async function membershipRoles(databaseUrl) {
  const host = neonSqlHost(databaseUrl);
  const direct = new URL(databaseUrl);
  direct.hostname = host;
  const response = await fetch(`https://${host}/sql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Neon-Connection-String": direct.toString(),
    },
    body: JSON.stringify({
      query:
        "select role_id, count(*)::int as n from wewebplus.memberships group by role_id",
      params: [],
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Membership store is unavailable (${response.status}) ${redact(await response.text()).slice(0, 180)}`,
    );
  }
  const payload = await response.json();
  const fields = payload.fields ?? [];
  return (payload.rows ?? []).map((row) => {
    if (!Array.isArray(row)) return row;
    const record = {};
    fields.forEach((field, index) => {
      record[field.name] = row[index];
    });
    return record;
  });
}

export async function ensureFormaClerkConfig(token) {
  if (!token) throw new Error("DOPPLER_ADMIN_TOKEN=absent");
  let secrets = await download(token);
  const missing = clerkReferencePlan(secretNames(secrets));
  if (Object.keys(missing).length > 0) {
    await doppler(token, "POST", "/v3/configs/config/secrets", {
      project: FORMA_PROJECT,
      config: FORMA_CONFIG,
      secrets: missing,
    });
    console.log(
      `forma_clerk_references=${Object.keys(missing).sort().join(",")}`,
    );
    secrets = await download(token);
  } else {
    console.log("forma_clerk_references=already");
  }
  const publishableKind = clerkKeyKind(secrets.CLERK_PUBLISHABLE_KEY);
  const secretKind = clerkKeyKind(secrets.CLERK_SECRET_KEY);
  assertDevelopmentClerk(publishableKind, secretKind);
  console.log(`forma_clerk_publishable=${publishableKind}`);
  console.log(`forma_clerk_secret=${secretKind}`);
  console.log(
    `forma_wewebplus_database=${secrets.WEWEBPLUS_DATABASE_URL ? "present" : "absent"}`,
  );
  if (
    publishableKind !== "test" ||
    secretKind !== "test" ||
    !secrets.WEWEBPLUS_DATABASE_URL
  ) {
    throw new Error("Forma dev is missing the development sign-in names");
  }
  const roles = membershipRoleSummary(
    await membershipRoles(secrets.WEWEBPLUS_DATABASE_URL),
  );
  console.log(`forma_membership_roles=${roles || "none"}`);
  if (!roles.includes("project-manager:1") || !roles.includes("developer:1")) {
    throw new Error("Wewebplus is missing the two gate roles");
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  ensureFormaClerkConfig(process.env.DOPPLER_ADMIN_TOKEN ?? "").catch(
    (error) => {
      console.log(redact(error?.message || error));
      process.exit(1);
    },
  );
}
