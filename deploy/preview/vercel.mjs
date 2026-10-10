// Point one Vercel Preview git branch at one Neon child.
// The Production target is never written. The connection string is never logged.

const vercelApi = "https://api.vercel.com";

export const defaultVercelProject = "dyad";
export const previewDatabaseKey = "WEWEBPLUS_DATABASE_URL";
export const previewGasCityKey = "NEXT_PUBLIC_GAS_CITY_URL";

export function previewGasCityOrigin(pr) {
  const value = String(pr);
  if (!/^[0-9]+$/.test(value)) {
    throw new Error("PR number must be digits");
  }
  return `https://gc-pr-${value}.anakwannaphaschaiyong.com`;
}

export function assertPreviewGitBranch(gitBranch) {
  if (gitBranch === "main" || !/^[A-Za-z0-9._/-]+$/.test(gitBranch || "")) {
    throw new Error("A non-production git branch is required");
  }
}

export function assertVercelAssignment(gitBranch, vercelToken) {
  if (!gitBranch) return;
  assertPreviewGitBranch(gitBranch);
  if (!vercelToken) throw new Error("VERCEL_TOKEN is not set");
}

export function assertRedeployed(result) {
  if (!result?.redeployed) {
    throw new Error(
      `No Vercel deployment to redeploy for ${result?.gitBranch || "the preview branch"}`,
    );
  }
}

function scrub(text) {
  return String(text)
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://redacted")
    .slice(0, 180);
}

function teamQuery(teamId) {
  return teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
}

async function vercelRequest(fetchImpl, token, path, options = {}) {
  const response = await fetchImpl(`${vercelApi}${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: { message: scrub(text) } };
    }
  }
  if (!response.ok) {
    const message = body.error?.message || body.message || "";
    const failure = new Error(
      `${options.method || "GET"} ${path.split("?")[0]} ${response.status} ${scrub(message)}`,
    );
    failure.vercelBody = body;
    throw failure;
  }
  return body;
}

function isExactPreviewKey(env, key, gitBranch) {
  const targets = Array.isArray(env.target) ? env.target : [];
  return (
    env.key === key &&
    env.gitBranch === gitBranch &&
    targets.length === 1 &&
    targets[0] === "preview"
  );
}

function envId(body) {
  return body.created?.id || body.id || "";
}

export async function assignPreviewVariable(options) {
  assertPreviewGitBranch(options.gitBranch);
  const key = options.key;
  if (!/^[A-Z][A-Z0-9_]+$/.test(key || "")) {
    throw new Error("A preview environment key is required");
  }
  if (!options.value) {
    throw new Error("A preview environment value is required");
  }
  const fetchImpl = options.fetchImpl || fetch;
  const token = options.token;
  const projectName = options.project || defaultVercelProject;
  const project = await vercelRequest(
    fetchImpl,
    token,
    `/v9/projects/${encodeURIComponent(projectName)}`,
  );
  const projectId = project.id || projectName;
  const teamId = String(project.accountId || "").startsWith("team_")
    ? project.accountId
    : "";
  const query = teamQuery(teamId);
  const listed = await vercelRequest(
    fetchImpl,
    token,
    `/v9/projects/${encodeURIComponent(projectId)}/env${query}`,
  );
  const envs = listed.envs || [];
  const dangerous = envs.find(
    (env) =>
      env.key === key &&
      env.gitBranch === options.gitBranch &&
      (env.target || []).includes("production"),
  );
  if (dangerous) {
    throw new Error("Refusing to change a production variable");
  }
  const existing = envs.find((env) =>
    isExactPreviewKey(env, key, options.gitBranch),
  );
  const payload = {
    key,
    value: options.value,
    type: "encrypted",
    target: ["preview"],
    gitBranch: options.gitBranch,
  };
  const saved = existing
    ? await vercelRequest(
        fetchImpl,
        token,
        `/v9/projects/${encodeURIComponent(projectId)}/env/${encodeURIComponent(existing.id)}${query}`,
        { method: "PATCH", body: payload },
      )
    : await vercelRequest(
        fetchImpl,
        token,
        `/v10/projects/${encodeURIComponent(projectId)}/env${query}`,
        { method: "POST", body: payload },
      );
  const id = envId(saved) || existing?.id || "";
  if (!id) throw new Error("Vercel did not return an environment id");
  const confirmed = await vercelRequest(
    fetchImpl,
    token,
    `/v9/projects/${encodeURIComponent(projectId)}/env${query}`,
  );
  const record = (confirmed.envs || []).find((env) => env.id === id);
  if (!record || !isExactPreviewKey(record, key, options.gitBranch)) {
    throw new Error("Vercel preview assignment was not found");
  }
  return {
    project: project.name || projectName,
    projectId,
    teamId,
    envId: id,
    key,
    gitBranch: record.gitBranch,
    targets: record.target.join(","),
  };
}

export async function assignPreviewDatabase(options) {
  if (!/^postgres(ql)?:\/\//.test(options.uri || "")) {
    throw new Error("Neon connection URI is required");
  }
  const assigned = await assignPreviewVariable({
    ...options,
    key: previewDatabaseKey,
    value: options.uri,
  });
  return {
    ...assigned,
    host: new URL(options.uri).hostname,
  };
}

export async function deletePreviewVariable(options) {
  assertPreviewGitBranch(options.gitBranch);
  const key = options.key || previewDatabaseKey;
  const fetchImpl = options.fetchImpl || fetch;
  const token = options.token;
  const projectName = options.project || defaultVercelProject;
  const project = await vercelRequest(
    fetchImpl,
    token,
    `/v9/projects/${encodeURIComponent(projectName)}`,
  );
  const projectId = project.id || projectName;
  const teamId = String(project.accountId || "").startsWith("team_")
    ? project.accountId
    : "";
  const query = teamQuery(teamId);
  const listed = await vercelRequest(
    fetchImpl,
    token,
    `/v9/projects/${encodeURIComponent(projectId)}/env${query}`,
  );
  const existing = (listed.envs || []).find((env) =>
    isExactPreviewKey(env, key, options.gitBranch),
  );
  if (!existing) {
    return { deleted: false, gitBranch: options.gitBranch, key };
  }
  await vercelRequest(
    fetchImpl,
    token,
    `/v9/projects/${encodeURIComponent(projectId)}/env/${encodeURIComponent(existing.id)}${query}`,
    { method: "DELETE" },
  );
  return {
    deleted: true,
    gitBranch: options.gitBranch,
    envId: existing.id,
    key,
  };
}

export async function deletePreviewDatabase(options) {
  return deletePreviewVariable({ ...options, key: previewDatabaseKey });
}

export function scopeSlug(error) {
  const match = /scope "([A-Za-z0-9-]+)"/.exec(
    error instanceof Error ? error.message : String(error || ""),
  );
  return match?.[1] || "";
}

export function teamIdFromDenied(error) {
  const body = error?.vercelBody;
  const id = body?.error?.teamId || body?.teamId || "";
  return typeof id === "string" && id.startsWith("team_") ? id : "";
}

function teamRecordId(body) {
  const id = body?.id || body?.team?.id || "";
  return typeof id === "string" && id.startsWith("team_") ? id : "";
}

async function teamIdForSlug(fetchImpl, token, slug) {
  try {
    const one = await vercelRequest(
      fetchImpl,
      token,
      `/v2/teams/${encodeURIComponent(slug)}`,
    );
    const id = teamRecordId(one);
    if (id) return id;
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (!text.includes(" 403 ")) throw error;
  }
  const listed = await vercelRequest(fetchImpl, token, "/v2/teams");
  const team = (listed.teams || []).find((item) => item.slug === slug);
  if (!team?.id) {
    throw new Error(`Vercel team ${slug} was not found for this token`);
  }
  return team.id;
}

async function openProject(fetchImpl, token, projectName, teamId) {
  const path = `/v9/projects/${encodeURIComponent(projectName)}`;
  if (teamId) {
    const query = String(teamId).startsWith("team_")
      ? `?teamId=${encodeURIComponent(teamId)}`
      : `?slug=${encodeURIComponent(teamId)}`;
    return vercelRequest(fetchImpl, token, `${path}${query}`);
  }
  try {
    return await vercelRequest(fetchImpl, token, path);
  } catch (error) {
    const slug = scopeSlug(error);
    const id =
      teamIdFromDenied(error) ||
      (slug ? await teamIdForSlug(fetchImpl, token, slug) : "");
    if (!id) throw error;
    console.log(`vercel_team_retry=${slug || "id"}`);
    return vercelRequest(
      fetchImpl,
      token,
      `${path}?teamId=${encodeURIComponent(id)}`,
    );
  }
}

export async function removeProjectDatabaseEnv(options) {
  const fetchImpl = options.fetchImpl || fetch;
  const token = options.token;
  if (!token) throw new Error("VERCEL_TOKEN is not set");
  const projectName = options.project || defaultVercelProject;
  const project = await openProject(
    fetchImpl,
    token,
    projectName,
    options.teamId || "",
  );
  const projectId = project.id || projectName;
  const teamId = String(project.accountId || "").startsWith("team_")
    ? project.accountId
    : "";
  const query = teamQuery(teamId);
  const listed = await vercelRequest(
    fetchImpl,
    token,
    `/v9/projects/${encodeURIComponent(projectId)}/env${query}`,
  );
  const matches = (listed.envs || []).filter(
    (env) => env.key === previewDatabaseKey,
  );
  const targets = [];
  for (const env of matches) {
    for (const target of env.target || []) targets.push(target);
    await vercelRequest(
      fetchImpl,
      token,
      `/v9/projects/${encodeURIComponent(projectId)}/env/${encodeURIComponent(env.id)}${query}`,
      { method: "DELETE" },
    );
  }
  const confirmed = await vercelRequest(
    fetchImpl,
    token,
    `/v9/projects/${encodeURIComponent(projectId)}/env${query}`,
  );
  const left = (confirmed.envs || []).filter(
    (env) => env.key === previewDatabaseKey,
  );
  if (left.length > 0) {
    throw new Error(
      "WEWEBPLUS_DATABASE_URL is still set on the Vercel project",
    );
  }
  return {
    project: project.name || projectName,
    removed: matches.length,
    targets: [...new Set(targets)].sort(),
  };
}

export function assignmentLog(record) {
  return `Assigned ${record.key} for pull request ${record.pr} git branch ${record.gitBranch} to Neon ${record.neonBranch} at ${record.host} on Vercel project ${record.project} target ${record.targets} env ${record.envId}`;
}

export async function redeployPreviewBranch(options) {
  const fetchImpl = options.fetchImpl || fetch;
  const team = options.teamId
    ? `&teamId=${encodeURIComponent(options.teamId)}`
    : "";
  const listed = await vercelRequest(
    fetchImpl,
    options.token,
    `/v6/deployments?projectId=${encodeURIComponent(options.projectId)}&limit=20${team}`,
  );
  const current = (listed.deployments || []).find(
    (item) =>
      item.meta?.githubCommitRef === options.gitBranch &&
      item.target !== "production",
  );
  if (!current?.uid) {
    return { redeployed: false, gitBranch: options.gitBranch };
  }
  const created = await vercelRequest(
    fetchImpl,
    options.token,
    `/v13/deployments${options.teamId ? `?teamId=${encodeURIComponent(options.teamId)}` : ""}`,
    {
      method: "POST",
      body: {
        name: options.project,
        deploymentId: current.uid,
      },
    },
  );
  return {
    redeployed: true,
    gitBranch: options.gitBranch,
    url: created.url || current.url || "",
  };
}
