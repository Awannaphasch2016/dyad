// Organize Doppler project forma from the non-production dyad preview config.
// Prints names and database host labels only. Does not read the production
// dyad config and does not print secret values.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const productionDatabaseHost = "ep-young-wave-b3cwe0rz";
export const unsanitizedNeonParentBranchId = "br-mute-shadow-b3jxqoho";

// Own secrets on forma/dev. AWS names stay inherited from aws.dev.
export const formaSecretNames = [
  "NOVNC_PASSWORD",
  "GAS_CITY_HOST_BRIDGE_TOKEN",
  "CLERK_SECRET_KEY",
  "CLERK_PUBLISHABLE_KEY",
  "WEWEBPLUS_SECRETS_KEY",
  "NEON_API_KEY",
  "NEON_DATABASE",
  "NEON_ROLE",
  "VERCEL_TOKEN",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ZONE_ID",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN_",
  "CLOUDFLARE_ZONE_ID_",
  "CLOUDFLARE_ACCOUNT_ID_",
];

const parentBranchPattern = /^br-[a-z0-9-]+$/;

export function databaseHostLabel(url) {
  try {
    const host = new URL(url).hostname || "";
    return host.split(".")[0] || "";
  } catch {
    return "";
  }
}

function bareDatabaseHost(url) {
  return databaseHostLabel(url).replace(/-pooler$/, "");
}

export function selectFormaDevSecrets(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("preview download must be an object");
  }
  const copied = {};
  const absent = [];
  for (const name of formaSecretNames) {
    const value = source[name];
    if (typeof value !== "string" || value.length === 0) {
      absent.push(name);
      continue;
    }
    copied[name] = value;
  }

  const report = {
    absent,
    database: "absent",
    neonParent: "absent",
  };
  const databaseUrl = source.WEWEBPLUS_DATABASE_URL;
  if (typeof databaseUrl === "string" && databaseUrl.length > 0) {
    const label = databaseHostLabel(databaseUrl);
    if (bareDatabaseHost(databaseUrl) === productionDatabaseHost) {
      report.database = "excluded_production";
      report.databaseHost = label;
    } else if (!label) {
      report.database = "excluded_unparsed";
    } else {
      copied.WEWEBPLUS_DATABASE_URL = databaseUrl;
      report.database = "copied";
      report.databaseHost = label;
    }
  }

  const parent = source.NEON_PARENT_BRANCH_ID;
  if (typeof parent === "string" && parent.length > 0) {
    const sanitized =
      parent !== unsanitizedNeonParentBranchId &&
      parentBranchPattern.test(parent);
    if (!sanitized) {
      report.neonParent = "excluded";
    } else {
      copied.NEON_PARENT_BRANCH_ID = parent;
      report.neonParent = "copied";
    }
  }
  return { copied, report };
}

function redact(text) {
  return String(text)
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://redacted")
    .replace(/dp\.(?:st|pt|sa|ct|said)\.[A-Za-z0-9._-]+/g, "dp.redacted")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "sk-redacted")
    .replace(/\bAIza[A-Za-z0-9_-]{8,}/g, "AIza-redacted")
    .slice(0, 500);
}

function doppler(args, { allowFail = false } = {}) {
  try {
    return execFileSync("doppler", args, {
      encoding: "utf8",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    if (allowFail) return null;
    const stderr = redact(error.stderr || "");
    const stdout = redact(error.stdout || "");
    console.log(`doppler_failed ${args.join(" ")}`);
    if (stderr) console.log(stderr);
    if (stdout) console.log(stdout);
    process.exit(1);
  }
}

function inheritLabel(entry) {
  if (typeof entry === "string") return entry;
  if (!entry || typeof entry !== "object") return "";
  if (typeof entry.name === "string") return entry.name;
  const project = typeof entry.project === "string" ? entry.project : "";
  const config = typeof entry.config === "string" ? entry.config : "";
  return project && config ? `${project}.${config}` : "";
}

function printConfigs(project) {
  const raw = doppler(["configs", "-p", project, "--json", "--silent"]);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.log(`${project}_configs=unparsed`);
    return;
  }
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.configs)
      ? parsed.configs
      : Array.isArray(parsed.page?.configs)
        ? parsed.page.configs
        : null;
  if (!list) {
    console.log(`${project}_configs=unparsed`);
    return;
  }
  console.log(`${project}_configs:`);
  for (const item of list) {
    const name = item.name || item.slug || "";
    const inherits = Array.isArray(item.inherits)
      ? item.inherits.map(inheritLabel).filter(Boolean).join(",")
      : "";
    console.log(`config=${name} inherits=${inherits || "none"}`);
  }
}

function organizeForma() {
  if (!process.env.DOPPLER_TOKEN) {
    console.log("DOPPLER_ADMIN_TOKEN=absent");
    process.exit(1);
  }
  console.log("DOPPLER_ADMIN_TOKEN=present");
  printConfigs("dyad");

  const existing = doppler(["projects", "get", "forma", "--silent"], {
    allowFail: true,
  });
  if (existing === null) {
    doppler([
      "projects",
      "create",
      "forma",
      "--description",
      "Isolated forma experiment. Copies dyad preview, not production.",
      "--silent",
    ]);
    console.log("forma_project=created");
  } else {
    console.log("forma_project=exists");
  }

  const download = doppler([
    "secrets",
    "download",
    "--silent",
    "--no-file",
    "--format",
    "json",
    "-p",
    "dyad",
    "-c",
    "preview",
  ]);
  const { copied, report } = selectFormaDevSecrets(JSON.parse(download));
  const host = report.databaseHost ? ` host=${report.databaseHost}` : "";
  console.log(`database=${report.database}${host}`);
  console.log(`neon_parent=${report.neonParent}`);
  console.log(`copied_names=${Object.keys(copied).sort().join(",")}`);
  console.log(`absent_names=${report.absent.join(",")}`);

  doppler([
    "configs",
    "update",
    "dev",
    "-p",
    "forma",
    "-c",
    "dev",
    "--inherits=aws.dev",
    "-y",
    "--silent",
  ]);
  console.log("forma_dev_inherits=aws.dev");

  if (Object.keys(copied).length === 0) {
    console.log("copy=empty");
  } else {
    const dir = mkdtempSync(join(tmpdir(), "forma-doppler-"));
    const file = join(dir, "secrets.json");
    try {
      writeFileSync(file, JSON.stringify(copied), { mode: 0o600 });
      doppler([
        "secrets",
        "upload",
        "--silent",
        "-p",
        "forma",
        "-c",
        "dev",
        file,
      ]);
      console.log("copy=ok");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const dropDatabase =
    report.database === "excluded_production" ||
    report.database === "excluded_unparsed";
  if (dropDatabase) {
    doppler(
      [
        "secrets",
        "delete",
        "WEWEBPLUS_DATABASE_URL",
        "-p",
        "forma",
        "-c",
        "dev",
        "-y",
        "--silent",
      ],
      { allowFail: true },
    );
  }
  if (report.neonParent === "excluded") {
    doppler(
      [
        "secrets",
        "delete",
        "NEON_PARENT_BRANCH_ID",
        "-p",
        "forma",
        "-c",
        "dev",
        "-y",
        "--silent",
      ],
      { allowFail: true },
    );
  }

  printConfigs("forma");
  const names = downloadedNames("forma", "dev");
  console.log(`forma_dev_names=${names.join(",")}`);
  const missing = Object.keys(copied).filter((name) => !names.includes(name));
  if (missing.length > 0) {
    console.log(`forma_dev_missing=${missing.join(",")}`);
    process.exit(1);
  }
  if (dropDatabase && names.includes("WEWEBPLUS_DATABASE_URL")) {
    console.log("forma_dev_database=still_present");
    process.exit(1);
  }
  for (const name of [
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_REGION",
  ]) {
    const state = names.includes(name) ? "present" : "absent";
    console.log(`inherited_${name}=${state}`);
  }
}

function downloadedNames(project, config) {
  const raw = doppler([
    "secrets",
    "download",
    "--silent",
    "--no-file",
    "--format",
    "json",
    "-p",
    project,
    "-c",
    config,
  ]);
  const parsed = JSON.parse(raw);
  return Object.keys(parsed)
    .filter((name) => !name.startsWith("DOPPLER_"))
    .sort();
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  organizeForma();
}
