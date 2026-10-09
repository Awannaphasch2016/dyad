#!/usr/bin/env node
// Phase 1 of plans/doppler-organization.md: add the `ci` and `prd`
// environments to the dyad project and fill them from the source configs
// listed in deploy/doppler/manifest.json (the first source that has a name
// wins). Adds beside the current config; moves and
// deletes nothing. Prints key=value result lines and never a secret value.
//
//   DOPPLER_TOKEN=... node scripts/doppler/migrate.mjs status
//   DOPPLER_TOKEN=... node scripts/doppler/migrate.mjs phase1
//   DOPPLER_TOKEN=... node scripts/doppler/migrate.mjs verify
//
// The token needs read on the source configs and write on the project. A
// service token is bound to one config and cannot do this; use a CLI token
// or a service-account token scoped to project dyad.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const API = "https://api.doppler.com/v3";

export function loadManifest(
  path = new URL("../../deploy/doppler/manifest.json", import.meta.url),
) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export class DopplerError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function makeClient(token, fetchImpl = fetch) {
  async function call(method, path, body) {
    const response = await fetchImpl(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    let json = {};
    try {
      json = await response.json();
    } catch {
      json = {};
    }
    if (!response.ok) {
      const detail = Array.isArray(json.messages)
        ? json.messages.join("; ")
        : "";
      throw new DopplerError(
        `${method} ${path.split("?")[0]} -> ${response.status}${detail ? ` (${detail})` : ""}`,
        response.status,
      );
    }
    return json;
  }
  return {
    environments: (project) =>
      call("GET", `/environments?project=${encodeURIComponent(project)}`).then(
        (r) => (r.environments || []).map((e) => e.slug),
      ),
    createEnvironment: (project, slug) =>
      call("POST", `/environments?project=${encodeURIComponent(project)}`, {
        name: slug,
        slug,
      }),
    configs: (project) =>
      call(
        "GET",
        `/configs?project=${encodeURIComponent(project)}&per_page=100`,
      ).then((r) => (r.configs || []).map((c) => c.name)),
    names: (project, config) =>
      call(
        "GET",
        `/configs/config/secrets/names?project=${encodeURIComponent(project)}&config=${encodeURIComponent(config)}`,
      ).then((r) => r.names || []),
    // Raw values keep `${ref}` strings as references instead of copying what
    // they resolve to.
    rawSecrets: (project, config) =>
      call(
        "GET",
        `/configs/config/secrets?project=${encodeURIComponent(project)}&config=${encodeURIComponent(config)}&include_managed_secrets=false`,
      ).then((r) => {
        const out = {};
        for (const [name, entry] of Object.entries(r.secrets || {})) {
          out[name] = entry && typeof entry.raw === "string" ? entry.raw : "";
        }
        return out;
      }),
    setSecrets: (project, config, secrets) =>
      call("POST", "/configs/config/secrets", { project, config, secrets }),
    whoIsThisToken: async (otherToken) => {
      const response = await fetchImpl(`${API}/configs/config`, {
        headers: {
          Authorization: `Bearer ${otherToken}`,
          Accept: "application/json",
        },
      });
      let json = {};
      try {
        json = await response.json();
      } catch {
        json = {};
      }
      const config = json.config || {};
      return {
        status: response.status,
        project: config.project || "unknown",
        config: config.name || "unknown",
      };
    },
  };
}

function reserved(name) {
  return name.startsWith("DOPPLER_") && name !== "DOPPLER_TOKEN";
}

export async function status(client, manifest, out) {
  const { project, sources } = manifest;
  const envs = await client.environments(project);
  out(`project=${project} environments=${envs.join(",")}`);
  const where = await locate(client, manifest);
  for (const source of sources) {
    const count = [...where.values()].filter((s) => s === source).length;
    out(`source_${source}=${count}`);
  }
  for (const [slug, env] of Object.entries(manifest.environments)) {
    const exists = envs.includes(slug);
    const have = exists
      ? new Set(await client.names(project, slug))
      : new Set();
    const missing = env.names.filter((n) => !have.has(n));
    const unsourced = env.names.filter((n) => !where.has(n));
    out(
      `${slug}=${exists ? "present" : "absent"} wanted=${env.names.length} present=${env.names.length - missing.length} missing=${missing.length}`,
    );
    for (const source of sources) {
      const fromHere = env.names.filter((n) => where.get(n) === source);
      if (fromHere.length) out(`${slug}_from_${source}=${fromHere.join(",")}`);
    }
    if (unsourced.length) out(`${slug}_not_in_sources=${unsourced.join(",")}`);
  }
}

// Which source config holds each manifest name: the first in order wins.
async function locate(client, manifest) {
  const where = new Map();
  for (const source of manifest.sources) {
    for (const name of await client.names(manifest.project, source)) {
      if (!where.has(name)) where.set(name, source);
    }
  }
  return where;
}

export async function phase1(client, manifest, out) {
  const { project, sources } = manifest;
  const envs = new Set(await client.environments(project));
  const where = await locate(client, manifest);
  const raw = {};
  for (const source of sources)
    raw[source] = await client.rawSecrets(project, source);
  let failures = 0;
  for (const [slug, env] of Object.entries(manifest.environments)) {
    if (!envs.has(slug)) {
      await client.createEnvironment(project, slug);
      out(`${slug}_environment=created`);
    } else {
      out(`${slug}_environment=present`);
    }
    const have = new Set(await client.names(project, slug));
    const toSet = {};
    const absentInSources = [];
    for (const name of env.names) {
      if (have.has(name) || reserved(name)) continue;
      const source = where.get(name);
      if (!source) {
        absentInSources.push(name);
        continue;
      }
      toSet[name] = raw[source][name];
    }
    if (Object.keys(toSet).length) {
      await client.setSecrets(project, slug, toSet);
    }
    out(
      `${slug}_copied=${Object.keys(toSet).length} already=${env.names.filter((n) => have.has(n)).length}`,
    );
    if (absentInSources.length) {
      failures += absentInSources.length;
      out(`${slug}_absent_in_sources=${absentInSources.join(",")}`);
    }
  }
  return failures === 0;
}

export async function verify(client, manifest, out) {
  const { project } = manifest;
  const envs = new Set(await client.environments(project));
  let ok = true;
  for (const [slug, env] of Object.entries(manifest.environments)) {
    if (!envs.has(slug)) {
      out(`${slug}=absent`);
      ok = false;
      continue;
    }
    const have = new Set(await client.names(project, slug));
    const missing = env.names.filter((n) => !have.has(n));
    const extra = [...have].filter(
      (n) => !env.names.includes(n) && !n.startsWith("DOPPLER_"),
    );
    out(`${slug}=present missing=${missing.length} extra=${extra.length}`);
    if (missing.length) {
      ok = false;
      out(`${slug}_missing=${missing.join(",")}`);
    }
    if (extra.length) out(`${slug}_extra=${extra.join(",")}`);
    if (
      env.names.includes("DOPPLER_TOKEN") &&
      !missing.includes("DOPPLER_TOKEN")
    ) {
      const raw = await client.rawSecrets(project, slug);
      const probe = await client.whoIsThisToken(raw.DOPPLER_TOKEN || "");
      out(
        `${slug}_doppler_token=http-${probe.status} project=${probe.project} config=${probe.config}`,
      );
      if (probe.status !== 200) ok = false;
    }
  }
  out(`phase1=${ok ? "ok" : "incomplete"}`);
  return ok;
}

export async function main(argv, io = {}) {
  const out = io.stdout || ((t) => process.stdout.write(`${t}\n`));
  const err = io.stderr || ((t) => process.stderr.write(`${t}\n`));
  const command = argv[0];
  if (!["status", "phase1", "verify"].includes(command)) {
    err("usage: migrate.mjs <status|phase1|verify>");
    return 2;
  }
  const token = io.token ?? process.env.DOPPLER_TOKEN ?? "";
  if (!token) {
    err("error: DOPPLER_TOKEN is not set\ncode: AUTH_REQUIRED");
    return 3;
  }
  const manifest = io.manifest || loadManifest();
  const client = io.client || makeClient(token);
  try {
    if (command === "status") {
      await status(client, manifest, out);
      return 0;
    }
    if (command === "phase1") {
      const complete = await phase1(client, manifest, out);
      return complete ? 0 : 1;
    }
    return (await verify(client, manifest, out)) ? 0 : 1;
  } catch (error) {
    if (error instanceof DopplerError) {
      err(
        `error: ${error.message}\ncode: ${error.status === 401 ? "AUTH_REQUIRED" : error.status === 403 ? "FORBIDDEN" : "DOPPLER_ERROR"}`,
      );
      return 3;
    }
    throw error;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
