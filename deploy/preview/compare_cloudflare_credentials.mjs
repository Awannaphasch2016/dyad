// Compare Cloudflare credential names across Doppler configs.
// Prints lengths, short hashes, and API results. Never prints secret values.

import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const CREDENTIAL_NAMES = [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_API_TOKEN_",
  "CLOUDFLARE_TUNNEL_TOKEN",
  "CLOUDFLARE_ZONE_ID",
  "CLOUDFLARE_ACCOUNT_ID",
];

const PLACES = [
  ["dyad", "preview"],
  ["dyad", "prd"],
  ["bolt", "preview"],
  ["vibesdk", "dev"],
];

export function fingerprint(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const text = value.trim();
  return {
    length: text.length,
    sha256_12: createHash("sha256").update(text).digest("hex").slice(0, 12),
    shape: credentialShape(text),
  };
}

export function credentialShape(value) {
  const text = String(value ?? "").trim();
  if (text === "") return "absent";
  if (text.startsWith("${")) return "unresolved";
  if (tunnelMetadata(text)) return "tunnel-credential";
  return "other";
}

export function tunnelMetadata(value) {
  const text = String(value ?? "").trim();
  if (!text.startsWith("eyJ")) return null;
  let decoded = "";
  try {
    decoded = Buffer.from(text, "base64").toString("utf8");
  } catch {
    return null;
  }
  let payload;
  try {
    payload = JSON.parse(decoded);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const tunnelId = typeof payload.t === "string" ? payload.t : "";
  const accountId = typeof payload.a === "string" ? payload.a : "";
  const secret = typeof payload.s === "string" ? payload.s : "";
  if (!tunnelId || !secret) return null;
  return {
    tunnelId,
    accountPresent: accountId.length > 0,
    secretPresent: secret.length > 0,
  };
}

export function publicCloudflareError(body) {
  const errors = Array.isArray(body?.errors) ? body.errors : [];
  if (errors.length === 0) return "none";
  return errors
    .map((error) => `${error?.code ?? "?"}:${error?.message ?? ""}`)
    .join("; ");
}

export function maskValue(value) {
  if (typeof value === "string" && value.length > 0) {
    process.stdout.write(`::add-mask::${value}\n`);
  }
}

function sameFingerprint(left, right) {
  if (!left || !right) return "absent";
  return left.sha256_12 === right.sha256_12 ? "yes" : "no";
}

async function downloadDoppler(token, project, config) {
  const params = new URLSearchParams({
    format: "json",
    project,
    config,
  });
  const response = await fetch(
    `https://api.doppler.com/v3/configs/config/secrets/download?${params}`,
    {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    },
  );
  if (!response.ok) {
    return { ok: false, status: response.status, values: {} };
  }
  const values = await response.json();
  for (const name of CREDENTIAL_NAMES) maskValue(values[name]);
  return { ok: true, status: response.status, values };
}

async function cloudflare(token, method, path, body) {
  const init = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };
  if (body) init.body = JSON.stringify(body);
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, init);
  const text = await response.text();
  let parsed = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = {};
  }
  return {
    status: response.status,
    ok: response.ok && parsed.success !== false,
    error: publicCloudflareError(parsed),
    result: parsed.result,
  };
}

async function probeApiToken(label, token, zoneId, accountId) {
  const verify = await cloudflare(token, "GET", "/user/tokens/verify");
  const verifyStatus =
    verify.result && typeof verify.result.status === "string"
      ? verify.result.status
      : "unknown";
  process.stdout.write(
    `probe ${label} user_verify=${verify.status} token_status=${verifyStatus} error=${verify.error}\n`,
  );
  if (accountId) {
    const accountVerify = await cloudflare(
      token,
      "GET",
      `/accounts/${accountId}/tokens/verify`,
    );
    const accountStatus =
      accountVerify.result && typeof accountVerify.result.status === "string"
        ? accountVerify.result.status
        : "unknown";
    process.stdout.write(
      `probe ${label} account_verify=${accountVerify.status} token_status=${accountStatus} error=${accountVerify.error}\n`,
    );
  }

  if (zoneId) {
    const listed = await cloudflare(
      token,
      "GET",
      `/zones/${zoneId}/dns_records?per_page=1`,
    );
    process.stdout.write(
      `probe ${label} dns_read=${listed.status} error=${listed.error}\n`,
    );
    const zone = await cloudflare(token, "GET", `/zones/${zoneId}`);
    const zoneName =
      zone.result && typeof zone.result.name === "string"
        ? zone.result.name
        : "";
    if (!/^[a-z0-9.-]+$/.test(zoneName)) {
      process.stdout.write(
        `probe ${label} dns_write=skipped zone=${zone.status} error=${zone.error}\n`,
      );
    } else {
      const name = `_dyad-credential-probe.${zoneName}`;
      const created = await cloudflare(
        token,
        "POST",
        `/zones/${zoneId}/dns_records`,
        { type: "TXT", name, content: "probe", ttl: 120 },
      );
      const recordId =
        created.result && typeof created.result.id === "string"
          ? created.result.id
          : "";
      let deleted = "not-created";
      if (/^[a-f0-9]{32}$/.test(recordId)) {
        const removal = await cloudflare(
          token,
          "DELETE",
          `/zones/${zoneId}/dns_records/${recordId}`,
        );
        deleted = removal.ok ? "deleted" : `delete-${removal.status}`;
      }
      process.stdout.write(
        `probe ${label} dns_write=${created.status} cleanup=${deleted} error=${created.error}\n`,
      );
    }
  } else {
    process.stdout.write(`probe ${label} dns_read=skipped zone_id=absent\n`);
  }

  if (accountId) {
    const workers = await cloudflare(
      token,
      "GET",
      `/accounts/${accountId}/workers/scripts?per_page=1`,
    );
    process.stdout.write(
      `probe ${label} workers_list=${workers.status} error=${workers.error}\n`,
    );
  } else {
    process.stdout.write(
      `probe ${label} workers_list=skipped account_id=absent\n`,
    );
  }
}

async function main() {
  const admin = process.env.DOPPLER_ADMIN_TOKEN || "";
  maskValue(admin);
  if (!admin) {
    process.stdout.write("doppler_admin_token=absent\n");
    process.exit(1);
  }
  process.stdout.write("doppler_admin_token=present\n");

  const maps = [];
  for (const [project, config] of PLACES) {
    const downloaded = await downloadDoppler(admin, project, config);
    const label = `${project}/${config}`;
    if (!downloaded.ok) {
      process.stdout.write(`download ${label} status=${downloaded.status}\n`);
      continue;
    }
    const names = Object.keys(downloaded.values).filter((name) =>
      name.toUpperCase().includes("CLOUDFLARE"),
    );
    process.stdout.write(
      `download ${label} cloudflare_names=${names.join(",") || "none"}\n`,
    );
    maps.push({ label, values: downloaded.values });
  }

  const githubToken = process.env.GITHUB_CLOUDFLARE_API_TOKEN || "";
  maskValue(githubToken);
  maps.push({
    label: "github-actions",
    values: { CLOUDFLARE_API_TOKEN: githubToken },
  });

  const printed = [];
  for (const map of maps) {
    for (const name of CREDENTIAL_NAMES) {
      const value = map.values[name];
      const print = fingerprint(value);
      if (!print) {
        process.stdout.write(`credential ${map.label} ${name} absent\n`);
        continue;
      }
      const meta = tunnelMetadata(value);
      const tunnel =
        meta === null
          ? ""
          : ` tunnel_id=${meta.tunnelId} tunnel_secret=${meta.secretPresent ? "present" : "absent"}`;
      process.stdout.write(
        `credential ${map.label} ${name} length=${print.length} sha256_12=${print.sha256_12} shape=${print.shape}${tunnel}\n`,
      );
      printed.push({
        label: map.label,
        name,
        value: String(value).trim(),
        print,
      });
    }
  }

  const formula = printed.find(
    (item) =>
      item.label === "dyad/preview" && item.name === "CLOUDFLARE_API_TOKEN",
  );
  const bolt = printed.find(
    (item) =>
      item.label === "bolt/preview" && item.name === "CLOUDFLARE_API_TOKEN",
  );
  const vibesdk = printed.find(
    (item) =>
      item.label === "vibesdk/dev" && item.name === "CLOUDFLARE_API_TOKEN",
  );
  const github = printed.find(
    (item) =>
      item.label === "github-actions" && item.name === "CLOUDFLARE_API_TOKEN",
  );
  const tunnel = printed.find(
    (item) => item.name === "CLOUDFLARE_TUNNEL_TOKEN",
  );
  process.stdout.write(
    `equal formula_api bolt_api ${sameFingerprint(formula?.print, bolt?.print)}\n`,
  );
  process.stdout.write(
    `equal formula_api vibesdk_api ${sameFingerprint(formula?.print, vibesdk?.print)}\n`,
  );
  process.stdout.write(
    `equal bolt_api vibesdk_api ${sameFingerprint(bolt?.print, vibesdk?.print)}\n`,
  );
  process.stdout.write(
    `equal formula_api github_api ${sameFingerprint(formula?.print, github?.print)}\n`,
  );
  process.stdout.write(
    `equal formula_api tunnel ${sameFingerprint(formula?.print, tunnel?.print)}\n`,
  );
  process.stdout.write(
    `equal bolt_api tunnel ${sameFingerprint(bolt?.print, tunnel?.print)}\n`,
  );

  const seen = new Set();
  for (const item of printed) {
    if (item.name !== "CLOUDFLARE_API_TOKEN") continue;
    if (item.print.shape === "tunnel-credential") continue;
    if (seen.has(item.print.sha256_12)) continue;
    seen.add(item.print.sha256_12);
    const owner = maps.find((map) => map.label === item.label);
    const zoneId = String(owner?.values.CLOUDFLARE_ZONE_ID ?? "").trim();
    const accountId = String(owner?.values.CLOUDFLARE_ACCOUNT_ID ?? "").trim();
    const zoneFromFormula = String(
      maps.find((map) => map.label === "dyad/preview")?.values
        .CLOUDFLARE_ZONE_ID ?? "",
    ).trim();
    const accountFromFormula = String(
      maps.find((map) => map.label === "dyad/preview")?.values
        .CLOUDFLARE_ACCOUNT_ID ?? "",
    ).trim();
    await probeApiToken(
      `${item.label} ${item.name} ${item.print.sha256_12}`,
      item.value,
      zoneId || zoneFromFormula,
      accountId || accountFromFormula,
    );
  }

  for (const item of printed) {
    if (item.name !== "CLOUDFLARE_TUNNEL_TOKEN") continue;
    if (seen.has(item.print.sha256_12)) continue;
    seen.add(item.print.sha256_12);
    const verify = await cloudflare(item.value, "GET", "/user/tokens/verify");
    process.stdout.write(
      `probe ${item.label} ${item.name} ${item.print.sha256_12} verify=${verify.status} error=${verify.error}\n`,
    );
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main().catch((error) => {
    const message = String(error?.message || error).replace(
      /Bearer\s+\S+/g,
      "Bearer [redacted]",
    );
    process.stdout.write(`compare_failed ${message}\n`);
    process.exit(1);
  });
}
