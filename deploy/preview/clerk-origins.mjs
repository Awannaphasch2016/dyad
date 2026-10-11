// Add one preview origin to the Clerk instance without dropping the others.

const PREVIEW_ORIGINS = [
  /^https:\/\/pr-[0-9]+\.anakwannaphaschaiyong\.com$/,
  /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/,
  /^https:\/\/vibesdk-pr-[0-9]+\.karant-test-egress-canary\.workers\.dev$/,
];

export function originsWith(existing, origin) {
  if (String(origin).includes("vibesdk-lab")) {
    throw new Error("refusing lab host");
  }
  if (!PREVIEW_ORIGINS.some((pattern) => pattern.test(origin))) {
    throw new Error("Preview origin is not a pr-<number> hostname");
  }
  const origins = [];
  for (const item of existing ?? []) {
    if (typeof item !== "string" || item.length === 0) continue;
    if (!origins.includes(item)) origins.push(item);
  }
  if (origins.includes(origin)) return { origins, added: false };
  return { origins: [...origins, origin], added: true };
}

export async function run() {
  const origin = process.env.PREVIEW_ORIGIN ?? "";
  const key = process.env.CLERK_SECRET_KEY ?? "";
  if (!PREVIEW_ORIGINS.some((pattern) => pattern.test(origin))) {
    console.error(
      "PREVIEW_ORIGIN must be the named preview host or a trycloudflare host",
    );
    process.exitCode = 2;
    return;
  }
  if (key.length === 0) {
    console.error("CLERK_SECRET_KEY is absent");
    process.exitCode = 2;
    return;
  }
  const headers = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  const current = await fetch("https://api.clerk.com/v1/instance", { headers });
  if (!current.ok) {
    console.error(`Clerk read failed: ${current.status}`);
    process.exitCode = 1;
    return;
  }
  const body = await current.json();
  const next = originsWith(body.allowed_origins, origin);
  if (!next.added) {
    console.log(`Clerk already allows ${origin}`);
    return;
  }
  const updated = await fetch("https://api.clerk.com/v1/instance", {
    method: "PATCH",
    headers,
    body: JSON.stringify({ allowed_origins: next.origins }),
  });
  if (updated.status !== 204) {
    console.error(`Clerk update failed: ${updated.status}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Clerk allows ${origin} (${next.origins.length} origins)`);
}

export async function allowPreviewOrigin({
  origin,
  secret,
  fetchImpl = fetch,
}) {
  const nextCheck = originsWith([], origin);
  if (!nextCheck.added) {
    throw new Error("Preview origin is not a pr-<number> hostname");
  }
  if (!String(secret ?? "").trim()) {
    throw new Error("CLERK_SECRET_KEY is absent");
  }
  const headers = {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
  };
  const current = await fetchImpl("https://api.clerk.com/v1/instance", {
    headers,
  });
  if (!current.ok) {
    throw new Error(`Clerk read failed: ${current.status}`);
  }
  const body = await current.json();
  const next = originsWith(body.allowed_origins, origin);
  if (!next.added) {
    console.log(`Clerk already allows ${origin}`);
    return;
  }
  const updated = await fetchImpl("https://api.clerk.com/v1/instance", {
    method: "PATCH",
    headers,
    body: JSON.stringify({ allowed_origins: next.origins }),
  });
  if (updated.status !== 204) {
    throw new Error(`Clerk update failed: ${updated.status}`);
  }
  console.log(`Clerk allows ${origin} (${next.origins.length} origins)`);
}
