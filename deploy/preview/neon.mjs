// Neon branch preview-pr-<number> under Wewebplus-hitl. The parent is Dev.

const neonApi = "https://console.neon.tech/api/v2";

export const defaultNeonProjectId = "mute-credit-71067312";
export const defaultNeonParentBranchId = "br-mute-shadow-b3jxqoho";
export const defaultNeonDatabase = "neondb";
export const defaultNeonRole = "neondb_owner";

export function previewBranchName(pr) {
  if (!/^[0-9]+$/.test(String(pr))) {
    throw new Error("Pull request number is required");
  }
  return `preview-pr-${pr}`;
}

function scrub(text) {
  return String(text)
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://redacted")
    .slice(0, 180);
}

async function neonRequest(key, path, options = {}) {
  const response = await fetch(`${neonApi}${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${key}`,
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
      body = { message: scrub(text) };
    }
  }
  if (!response.ok) {
    throw new Error(
      `${options.method || "GET"} ${path} ${response.status} ${scrub(body.message || "")}`,
    );
  }
  return body;
}

async function waitForOperations(key, projectId, operations) {
  for (const operation of operations || []) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const current = await neonRequest(
        key,
        `/projects/${projectId}/operations/${operation.id}`,
      );
      const status = current.operation?.status;
      if (status === "finished") break;
      if (status === "failed" || status === "cancelled") {
        throw new Error(`Neon operation ${status}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

export async function ensurePreviewBranch(options) {
  const key = options.apiKey;
  const projectId = options.projectId || defaultNeonProjectId;
  const parentId = options.parentBranchId || defaultNeonParentBranchId;
  const database = options.database || defaultNeonDatabase;
  const role = options.role || defaultNeonRole;
  const name = previewBranchName(options.pr);
  const listed = await neonRequest(key, `/projects/${projectId}/branches`);
  let branch = (listed.branches || []).find((item) => item.name === name);
  if (!branch) {
    const created = await neonRequest(key, `/projects/${projectId}/branches`, {
      method: "POST",
      body: {
        branch: { parent_id: parentId, name },
        endpoints: [{ type: "read_write" }],
      },
    });
    branch = created.branch;
    await waitForOperations(key, projectId, created.operations);
  }
  const connection = await neonRequest(
    key,
    `/projects/${projectId}/connection_uri?branch_id=${encodeURIComponent(branch.id)}&database_name=${encodeURIComponent(database)}&role_name=${encodeURIComponent(role)}&pooled=true`,
  );
  if (!connection.uri || !/^postgres(ql)?:\/\//.test(connection.uri)) {
    throw new Error("Neon did not return a connection URI");
  }
  return {
    name,
    branchId: branch.id,
    uri: connection.uri,
    host: new URL(connection.uri).hostname,
  };
}

export async function deletePreviewBranch(options) {
  const key = options.apiKey;
  const projectId = options.projectId || defaultNeonProjectId;
  const name = previewBranchName(options.pr);
  const listed = await neonRequest(key, `/projects/${projectId}/branches`);
  const branch = (listed.branches || []).find((item) => item.name === name);
  if (!branch) return { deleted: false, name };
  await neonRequest(key, `/projects/${projectId}/branches/${branch.id}`, {
    method: "DELETE",
  });
  return { deleted: true, name };
}
