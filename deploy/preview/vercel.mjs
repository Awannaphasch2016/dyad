// Point one Vercel Preview git branch at one Neon child.
// The Production target is never written. The connection string is never logged.

const vercelApi = "https://api.vercel.com";

export const defaultVercelProject = "dyad";
export const previewDatabaseKey = "WEWEBPLUS_DATABASE_URL";

export function assertPreviewGitBranch(gitBranch) {
  if (gitBranch === "main" || !/^[A-Za-z0-9._/-]+$/.test(gitBranch || "")) {
    throw new Error("A non-production git branch is required");
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
    throw new Error(
      `${options.method || "GET"} ${path.split("?")[0]} ${response.status} ${scrub(message)}`,
    );
  }
  return body;
}

function isExactPreviewBranch(env, gitBranch) {
  const targets = Array.isArray(env.target) ? env.target : [];
  return (
    env.key === previewDatabaseKey &&
    env.gitBranch === gitBranch &&
    targets.length === 1 &&
    targets[0] === "preview"
  );
}

function envId(body) {
  return body.created?.id || body.id || "";
}

export async function assignPreviewDatabase(options) {
  assertPreviewGitBranch(options.gitBranch);
  if (!/^postgres(ql)?:\/\//.test(options.uri || "")) {
    throw new Error("Neon connection URI is required");
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
      env.key === previewDatabaseKey &&
      env.gitBranch === options.gitBranch &&
      (env.target || []).includes("production"),
  );
  if (dangerous) {
    throw new Error("Refusing to change a production database variable");
  }
  const existing = envs.find((env) =>
    isExactPreviewBranch(env, options.gitBranch),
  );
  const payload = {
    key: previewDatabaseKey,
    value: options.uri,
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
  if (!record || !isExactPreviewBranch(record, options.gitBranch)) {
    throw new Error("Vercel preview database assignment was not found");
  }
  return {
    project: project.name || projectName,
    projectId,
    teamId,
    envId: id,
    key: previewDatabaseKey,
    gitBranch: record.gitBranch,
    targets: record.target.join(","),
    host: new URL(options.uri).hostname,
  };
}

export async function deletePreviewDatabase(options) {
  assertPreviewGitBranch(options.gitBranch);
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
    isExactPreviewBranch(env, options.gitBranch),
  );
  if (!existing) {
    return { deleted: false, gitBranch: options.gitBranch };
  }
  await vercelRequest(
    fetchImpl,
    token,
    `/v9/projects/${encodeURIComponent(projectId)}/env/${encodeURIComponent(existing.id)}${query}`,
    { method: "DELETE" },
  );
  return { deleted: true, gitBranch: options.gitBranch, envId: existing.id };
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
