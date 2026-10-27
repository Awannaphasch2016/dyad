// Look up the two existing walkthrough accounts. Does not create users,
// change memberships, or print secrets.

const PM_EMAIL = "walkthrough-pm+clerk_test@example.com";
const DEV_EMAIL = "walkthrough-dev+clerk_test@example.com";

function required(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) throw new Error(`${name} is not available`);
  return value;
}

async function clerkUserId(secret, email) {
  const response = await fetch(
    `https://api.clerk.com/v1/users?email_address=${encodeURIComponent(email)}`,
    { headers: { Authorization: `Bearer ${secret}` } },
  );
  if (!response.ok) throw new Error(`clerk user lookup ${response.status}`);
  const users = await response.json();
  const user = Array.isArray(users) ? users[0] : null;
  if (!user?.id) throw new Error(`clerk user missing for ${email}`);
  return user.id;
}

async function membership(databaseUrl, userId) {
  const endpoint = new URL(databaseUrl);
  const host = endpoint.hostname.replace("-pooler.", ".");
  endpoint.hostname = host;
  const response = await fetch(`https://${host}/sql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Neon-Connection-String": endpoint.toString(),
    },
    body: JSON.stringify({
      query:
        "select org_id, role_id from wewebplus.memberships where user_id = $1",
      params: [userId],
    }),
  });
  if (!response.ok) throw new Error(`membership lookup ${response.status}`);
  const payload = await response.json();
  const fields = payload.fields ?? [];
  const rows = (payload.rows ?? []).map((row) => {
    if (!Array.isArray(row)) return row;
    const record = {};
    fields.forEach((field, index) => {
      record[field.name] = row[index];
    });
    return record;
  });
  const usable = rows.filter(
    (row) => row.role_id === "project-manager" || row.role_id === "developer",
  );
  if (usable.length !== 1) {
    throw new Error(`membership count ${usable.length} for ${userId}`);
  }
  return { orgId: String(usable[0].org_id), role: String(usable[0].role_id) };
}

const secret = required("CLERK_SECRET_KEY");
const databaseUrl = required("WEWEBPLUS_DATABASE_URL");
const pmUserId = await clerkUserId(secret, PM_EMAIL);
const devUserId = await clerkUserId(secret, DEV_EMAIL);
const pm = await membership(databaseUrl, pmUserId);
const dev = await membership(databaseUrl, devUserId);
if (pm.orgId !== dev.orgId)
  throw new Error("the two accounts are in different organizations");
if (pm.role !== "project-manager" || dev.role !== "developer") {
  throw new Error("the two accounts do not have the two roles");
}

const lines = [
  `pm_user_id=${pmUserId}`,
  `dev_user_id=${devUserId}`,
  "pm_role=project-manager",
  "dev_role=developer",
  "same_org=yes",
];
console.log(lines.join("\n"));
if (process.env.GITHUB_OUTPUT) {
  const { appendFileSync } = await import("node:fs");
  appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
}
