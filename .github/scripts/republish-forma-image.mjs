#!/usr/bin/env node
// Add an empty commit on the Forma image branch so Publish Forma image runs.
// Prints the new commit SHA. Does not print credentials.

import { writeSync } from "node:fs";
import { pathToFileURL } from "node:url";

const owner = "Awannaphasch2016";
const repo = "forma";
const branch = "cursor/forma-preview-walkthrough";

export function redact(text) {
  return String(text ?? "")
    .replace(/ghs_[A-Za-z0-9_]+/g, "ghs_REDACTED")
    .replace(/ghp_[A-Za-z0-9_]+/g, "ghp_REDACTED")
    .replace(/Bearer\s+\S+/gi, "Bearer REDACTED");
}

function headers(token, extra = {}) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "dyad-preview-forma",
    "X-GitHub-Api-Version": "2022-11-28",
    ...extra,
  };
}

export async function republishFormaImage({ token, fetchImpl = fetch }) {
  const refResponse = await fetchImpl(
    `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${branch}`,
    { headers: headers(token) },
  );
  if (!refResponse.ok) throw new Error(`forma_ref ${refResponse.status}`);
  const parent = (await refResponse.json()).object?.sha;
  if (!/^[0-9a-f]{40}$/.test(parent ?? "")) {
    throw new Error("forma_ref missing sha");
  }

  const commitResponse = await fetchImpl(
    `https://api.github.com/repos/${owner}/${repo}/git/commits/${parent}`,
    { headers: headers(token) },
  );
  if (!commitResponse.ok)
    throw new Error(`forma_commit ${commitResponse.status}`);
  const tree = (await commitResponse.json()).tree?.sha;
  if (!tree) throw new Error("forma_commit missing tree");

  const created = await fetchImpl(
    `https://api.github.com/repos/${owner}/${repo}/git/commits`,
    {
      method: "POST",
      headers: headers(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        message: "Republish the Forma image so the package is listed.",
        tree,
        parents: [parent],
      }),
    },
  );
  if (!created.ok) throw new Error(`forma_empty_commit ${created.status}`);
  const sha = (await created.json()).sha;
  if (!/^[0-9a-f]{40}$/.test(sha ?? "")) {
    throw new Error("forma_empty_commit missing sha");
  }

  const updated = await fetchImpl(
    `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`,
    {
      method: "PATCH",
      headers: headers(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ sha }),
    },
  );
  if (!updated.ok) throw new Error(`forma_branch ${updated.status}`);
  return { parent, sha };
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const token = process.env.GH_TOKEN ?? "";
  const log = (line) => writeSync(1, `${redact(line)}\n`);
  if (!token) {
    log("GH_TOKEN=absent");
    process.exit(1);
  }
  republishFormaImage({ token })
    .then(({ parent, sha }) => {
      log(`forma_republish_parent=${parent}`);
      log(`forma_republish_sha=${sha}`);
    })
    .catch((error) => {
      log(redact(error?.message || String(error)));
      process.exit(1);
    });
}
