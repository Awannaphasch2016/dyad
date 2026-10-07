// Copy Auto provider key names from dyad/dev into dyad/canary.
// Prints names only. Never copies WEWEBPLUS_DATABASE_URL.

import {
  absentAutoKeys,
  autoKeysAfterCopy,
  chooseDevConfig,
  configLabels,
  modelKeysToCopy,
} from "./model-keys.mjs";

function redact(text) {
  return String(text)
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://redacted")
    .replace(/dp\.(?:st|pt|sa|ct|said)\.[A-Za-z0-9._-]+/g, "dp.redacted")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "sk-redacted")
    .replace(/\bAIza[A-Za-z0-9_-]{8,}/g, "AIza-redacted")
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
    `/v3/configs/config/secrets/download?project=dyad&config=${encodeURIComponent(config)}&format=json`,
  );
  return Object.fromEntries(
    Object.entries(payload).filter((entry) => typeof entry[1] === "string"),
  );
}

const token = process.env.DOPPLER_ADMIN_TOKEN ?? "";
if (!token) {
  console.log("admin_token=absent");
  process.exit(1);
}

const listed = await doppler(token, "GET", "/v3/configs?project=dyad");
const configs = listed.configs ?? [];
console.log(`configs=${configLabels(configs).join(",") || "none"}`);
const source = chooseDevConfig(configs);
if (!source) {
  console.error("dev_config=absent");
  process.exit(1);
}
console.log(`source=dyad/${source}`);
const dev = await download(token, source);
const canary = await download(token, "canary");
const copy = modelKeysToCopy(dev);
const names = Object.keys(copy);
if (names.length > 0) {
  await doppler(token, "POST", "/v3/configs/config/secrets", {
    project: "dyad",
    config: "canary",
    secrets: copy,
  });
}
const absent = absentAutoKeys(dev);
const available = autoKeysAfterCopy(dev, canary);
console.log(`copied=${names.join(",") || "none"}`);
console.log(`absent=${absent.join(",") || "none"}`);
if (available.length === 0) {
  console.error("auto_keys=none");
  process.exit(1);
}
