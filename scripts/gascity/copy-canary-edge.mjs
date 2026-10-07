// Copy Cloudflare and Vercel names into dyad/canary when they are missing.
// The database URL is never copied.

import { secretsToCopy } from "./canary-identity.mjs";

function redact(text) {
  return String(text)
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://redacted")
    .replace(/dp\.(?:st|pt|sa|ct|said)\.[A-Za-z0-9._-]+/g, "dp.redacted")
    .slice(0, 180);
}

async function doppler(token, method, path, body) {
  const response = await fetch(`https://api.doppler.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(
      `${method} ${path.split("?")[0]} ${response.status} ${redact(payload.message || text)}`,
    );
  }
  return payload;
}

async function download(token, config) {
  const payload = await doppler(
    token,
    "GET",
    `/v3/configs/config/secrets/download?project=dyad&config=${config}&format=json`,
  );
  return Object.fromEntries(
    Object.entries(payload).filter((entry) => typeof entry[1] === "string"),
  );
}

const token = process.env.DOPPLER_ADMIN_TOKEN ?? "";
if (!token) {
  console.log("admin_token=absent");
} else {
  const canary = await download(token, "canary");
  const preview = await download(token, "preview");
  const copy = secretsToCopy(preview, canary);
  const names = Object.keys(copy);
  if (names.length > 0) {
    await doppler(token, "POST", "/v3/configs/config/secrets", {
      project: "dyad",
      config: "canary",
      secrets: copy,
    });
  }
  console.log(`copied=${names.join(",") || "none"}`);
}
