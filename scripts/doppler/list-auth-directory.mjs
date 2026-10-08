// Read-only directory check. Prints who is signed in. Does not print secret values
// and does not change Clerk or the database.

const KNOWN = [
  "anakwannaphaschaiyong@gmail.com",
  "awannaphasch2016@fau.edu",
];

const CONFIGS = [
  ["dyad", "dev"],
  ["dyad", "preview"],
  ["dyad", "prd"],
];

function redact(value) {
  return String(value)
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://redacted")
    .replace(/sk_(test|live)_\S+/g, "sk_$1_redacted")
    .replace(/pk_(test|live)_\S+/g, "pk_$1_redacted");
}

async function dopplerDownload(token, project, config) {
  const response = await fetch(
    `https://api.doppler.com/v3/configs/config/secrets/download?project=${project}&config=${config}&format=json`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
  );
  const text = await response.text();
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`doppler ${project}/${config} ${response.status} ${redact(text).slice(0, 180)}`);
  }
  return JSON.parse(text);
}

function keyKind(value) {
  const key = String(value ?? "").trim();
  if (key.startsWith("sk_test_")) return "sk_test";
  if (key.startsWith("sk_live_")) return "sk_live";
  if (!key) return "absent";
  return "other";
}

async function clerkGet(secret, path) {
  const response = await fetch(`https://api.clerk.com${path}`, {
    headers: { Authorization: `Bearer ${secret}`, Accept: "application/json" },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`clerk ${path} ${response.status} ${redact(text).slice(0, 180)}`);
  }
  return text ? JSON.parse(text) : {};
}

async function clerkList(secret, path) {
  const rows = [];
  for (let offset = 0; offset < 500; offset += 100) {
    const body = await clerkGet(secret, `${path}${path.includes("?") ? "&" : "?"}limit=100&offset=${offset}`);
    const page = Array.isArray(body) ? body : body.data ?? [];
    rows.push(...page);
    if (page.length < 100) break;
  }
  return rows;
}

function domainOf(email) {
  const at = email.lastIndexOf("@");
  return at === -1 ? "absent" : email.slice(at + 1);
}

async function reportClerk(secret) {
  const users = await clerkList(secret, "/v1/users");
  const orgs = await clerkList(secret, "/v1/organizations");
  const memberships = [];
  for (const org of orgs) {
    const rows = await clerkList(secret, `/v1/organizations/${org.id}/memberships`);
    for (const row of rows) {
      const userId = row.public_user_data?.user_id ?? "";
      memberships.push({
        userId,
        orgId: org.id,
        orgName: org.name ?? "",
        clerkRole: row.role ?? "",
      });
    }
  }
  console.log(`clerk_users=${users.length} clerk_orgs=${orgs.length}`);
  for (const org of orgs) {
    console.log(`org id=${org.id} name=${org.name ?? ""} members=${org.members_count ?? ""}`);
  }
  let other = 0;
  for (const user of users) {
    const emails = (user.email_addresses ?? [])
      .map((item) => String(item.email_address ?? "").toLowerCase())
      .filter(Boolean);
    const providers = (user.external_accounts ?? [])
      .map((item) => item.provider)
      .filter(Boolean);
    const known = emails.some((email) => KNOWN.includes(email));
    const orgsForUser = memberships.filter((item) => item.userId === user.id);
    const orgText = orgsForUser
      .map((item) => `${item.orgId}:${item.clerkRole}`)
      .join(",") || "none";
    if (known) {
      console.log(
        `known id=${user.id} email=${emails.join("|") || "absent"} providers=${providers.join("|") || "absent"} orgs=${orgText}`,
      );
    } else {
      other += 1;
      console.log(
        `other id=${user.id} domain=${emails.map(domainOf).join("|") || "absent"} providers=${providers.join("|") || "absent"} orgs=${orgText}`,
      );
    }
  }
  console.log(`other_users=${other}`);
}

async function neonQuery(databaseUrl, query) {
  const endpoint = new URL(databaseUrl);
  const response = await fetch(`https://${endpoint.host}/sql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Neon-Connection-String": databaseUrl,
    },
    body: JSON.stringify({ query, params: [] }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`neon ${response.status} ${redact(text).slice(0, 180)}`);
  }
  const body = JSON.parse(text);
  return body.rows ?? body;
}

async function reportDatabase(databaseUrl) {
  const memberships = await neonQuery(
    databaseUrl,
    "select user_id, org_id, role_id from wewebplus.memberships order by org_id, role_id",
  );
  const owners = await neonQuery(
    databaseUrl,
    "select owner_type, owner_id, count(*)::int as apps from wewebplus.apps group by owner_type, owner_id order by owner_type, owner_id",
  );
  console.log(`db_memberships=${memberships.length}`);
  for (const row of memberships) {
    console.log(`membership user=${row.user_id} org=${row.org_id} role=${row.role_id}`);
  }
  console.log(`db_owner_groups=${owners.length}`);
  for (const row of owners) {
    console.log(`owner type=${row.owner_type} id=${row.owner_id} apps=${row.apps}`);
  }
}

async function main() {
  const token = process.env.DOPPLER_ADMIN_TOKEN ?? "";
  if (!token) {
    console.log("admin_token=absent");
    process.exit(1);
  }
  console.log("admin_token=present");
  const seen = new Map();
  for (const [project, config] of CONFIGS) {
    const secrets = await dopplerDownload(token, project, config);
    if (!secrets) {
      console.log(`config=${project}/${config} status=absent`);
      continue;
    }
    const kind = keyKind(secrets.CLERK_SECRET_KEY);
    const db = String(secrets.WEWEBPLUS_DATABASE_URL ?? "").trim() ? "present" : "absent";
    console.log(`config=${project}/${config} clerk=${kind} database=${db}`);
    if (kind === "absent") continue;
    const marker = secrets.CLERK_SECRET_KEY;
    if (seen.has(marker)) {
      console.log(`clerk_directory=same_as_${seen.get(marker)}`);
    } else {
      seen.set(marker, `${project}/${config}`);
      await reportClerk(marker);
    }
    if (db === "present") {
      const dbMarker = secrets.WEWEBPLUS_DATABASE_URL;
      const dbLabel = `db:${project}/${config}`;
      if ([...seen.entries()].some(([value, label]) => value === dbMarker && label.startsWith("db:"))) {
        const prior = [...seen.entries()].find(([value]) => value === dbMarker)?.[1];
        console.log(`database_rows=same_as_${prior}`);
      } else {
        seen.set(dbMarker, dbLabel);
        await reportDatabase(dbMarker);
      }
    }
  }
}

main().catch((error) => {
  console.log(redact(error?.message || error));
  process.exit(1);
});
