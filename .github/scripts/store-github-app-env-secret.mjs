import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const TARGET_REPOSITORY = "Awannaphasch2016/dyad";
export const ENVIRONMENT_NAME = "ai-bots";
export const SECRET_NAME = "DYAD_GITHUB_APP_SECRET_KEY";
export const PRIVATE_KEY_SECRET_NAME = "DYAD_GITHUB_APP_PRIVATE_KEY";
export const APP_ID_VARIABLE = "DYAD_GITHUB_APP_ID";
export const DEFAULT_APP_ID = "5221649";

export function resolveAppId(raw) {
  const trimmed = String(raw ?? "").trim();
  return trimmed || DEFAULT_APP_ID;
}

export function createAppJwt(
  pem,
  appId,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iat: nowSeconds - 60,
      exp: nowSeconds + 540,
      iss: String(appId),
    }),
  ).toString("base64url");
  const unsigned = `${header}.${payload}`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(unsigned)
    .sign(pem)
    .toString("base64url");
  return `${unsigned}.${signature}`;
}

export const APP_PERMISSIONS_URL =
  "https://github.com/settings/apps/dyad-harness/permissions";

export function installationApprovalUrl(installationId) {
  return `https://github.com/settings/installations/${installationId}`;
}

function redact(text, secrets) {
  let out = String(text ?? "");
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join("[redacted]");
  }
  return out;
}

async function github(url, { token, method = "GET", body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    const message = json?.message || text.slice(0, 300);
    throw new Error(`${method} ${url} -> ${response.status} ${message}`);
  }
  return json;
}

function setEnvironmentSecret({ token, repository, name, value }) {
  try {
    execFileSync(
      "gh",
      ["secret", "set", name, "--env", ENVIRONMENT_NAME, "--repo", repository],
      {
        input: value,
        env: { ...process.env, GH_TOKEN: token, GITHUB_TOKEN: token },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
  } catch (error) {
    const stderr = redact(error.stderr?.toString?.() || error.message, [
      value,
      token,
    ]);
    throw new Error(`Failed to set ${name} on ${ENVIRONMENT_NAME}: ${stderr}`);
  }
}

async function upsertEnvironmentVariable({ token, repository, name, value }) {
  const base = `https://api.github.com/repos/${repository}/environments/${ENVIRONMENT_NAME}/variables`;
  try {
    await github(base, { token, method: "POST", body: { name, value } });
  } catch (error) {
    if (!String(error.message).includes("409")) throw error;
    await github(`${base}/${name}`, {
      token,
      method: "PATCH",
      body: { name, value },
    });
  }
}

export async function storeGithubAppEnvSecret({
  pem,
  appId,
  repository,
  githubRequest = github,
  setSecret = setEnvironmentSecret,
  upsertVariable = upsertEnvironmentVariable,
  createJwt = createAppJwt,
} = {}) {
  if (repository !== TARGET_REPOSITORY) {
    throw new Error(
      `This workflow only stores the secret on ${TARGET_REPOSITORY}.`,
    );
  }
  if (!pem || !pem.includes("BEGIN") || !pem.includes("PRIVATE KEY")) {
    throw new Error(
      "DYAD_GITHUB_APP_PEM_KEY is missing or is not a PEM private key. The value was not printed.",
    );
  }

  const jwt = createJwt(pem, appId);
  const installation = await githubRequest(
    `https://api.github.com/repos/${repository}/installation`,
    { token: jwt },
  );
  if (installation.permissions?.environments !== "write") {
    throw new Error(
      `dyad-harness cannot write environment secrets yet. On ${APP_PERMISSIONS_URL} set Repository permissions > Environments to Read and write, save, then accept the new permission at ${installationApprovalUrl(installation.id)} and run this workflow again.`,
    );
  }

  const tokenResponse = await githubRequest(
    `https://api.github.com/app/installations/${installation.id}/access_tokens`,
    {
      token: jwt,
      method: "POST",
      body: {
        repositories: [repository.split("/")[1]],
        permissions: { environments: "write", metadata: "read" },
      },
    },
  );

  await setSecret({
    token: tokenResponse.token,
    repository,
    name: SECRET_NAME,
    value: pem,
  });
  await setSecret({
    token: tokenResponse.token,
    repository,
    name: PRIVATE_KEY_SECRET_NAME,
    value: pem,
  });
  await upsertVariable({
    token: tokenResponse.token,
    repository,
    name: APP_ID_VARIABLE,
    value: String(appId),
  });

  console.log(
    `Saved ${SECRET_NAME} and ${PRIVATE_KEY_SECRET_NAME} on environment ${ENVIRONMENT_NAME}, and set ${APP_ID_VARIABLE}.`,
  );
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  storeGithubAppEnvSecret({
    pem: process.env.PEM,
    appId: resolveAppId(process.env.APP_ID),
    repository: process.env.GITHUB_REPOSITORY,
  }).catch((error) => {
    console.error(redact(error.message, [process.env.PEM]));
    process.exit(1);
  });
}
