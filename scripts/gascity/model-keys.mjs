// Model key names the Auto provider can use. Values stay out of this file.
// The canary database URL is never part of the copy.

export const autoModelKeyNames = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "OPENROUTER_API_KEY",
];

export const optionalModelKeyNames = ["AWS_BEARER_TOKEN_BEDROCK"];

export const modelKeyNames = [...autoModelKeyNames, ...optionalModelKeyNames];

const blockedSourceNames = new Set([
  "prd",
  "prod",
  "production",
  "canary",
  "preview",
  "stg",
  "stage",
  "staging",
]);

export function configLabels(configs) {
  return (configs ?? [])
    .map((item) => {
      const name = String(item?.name ?? "");
      const environment = String(item?.environment ?? "");
      if (!name) return "";
      return environment ? `${name}:${environment}` : name;
    })
    .filter(Boolean);
}

export function sourceLabels(projects) {
  return (projects ?? [])
    .map((project) => {
      const name = String(project?.name ?? "");
      if (!name) return "";
      return `${name}[${configLabels(project?.configs).join(",")}]`;
    })
    .filter(Boolean);
}

export function chooseDevSource(projects) {
  const rows = (projects ?? [])
    .map((project) => ({
      project: String(project?.name ?? ""),
      config: chooseDevConfig(project?.configs),
    }))
    .filter((row) => row.project && row.config);
  const dyad = rows.find((row) => row.project === "dyad");
  if (dyad) return { project: dyad.project, config: dyad.config };
  const named = rows.filter((row) => /dyad/i.test(row.project));
  if (named.length === 1) {
    return { project: named[0].project, config: named[0].config };
  }
  return null;
}

export function chooseModelKeySource(projects) {
  const fromDev = chooseDevSource(projects);
  if (fromDev) return { ...fromDev, fallback: false };
  const dyad = (projects ?? []).find((project) => project?.name === "dyad");
  const hasPreview = (dyad?.configs ?? []).some(
    (config) => config?.name === "preview",
  );
  if (hasPreview) return { project: "dyad", config: "preview", fallback: true };
  return null;
}

export function chooseDevConfig(configs) {
  const rows = [];
  for (const item of configs ?? []) {
    const name = String(item?.name ?? "");
    if (!name || blockedSourceNames.has(name)) continue;
    rows.push({
      name,
      environment: String(item?.environment ?? ""),
      root: item?.root === true,
    });
  }
  if (rows.some((item) => item.name === "dev")) return "dev";
  const devEnv = rows.filter((item) => item.environment === "dev");
  const roots = devEnv.filter((item) => item.root);
  if (roots.length === 1) return roots[0].name;
  if (devEnv.length === 1) return devEnv[0].name;
  return "";
}

function present(env, name) {
  const value = env?.[name];
  return typeof value === "string" && value.trim().length > 0;
}

export function assertModelKeyCopy(copy) {
  if (Object.hasOwn(copy ?? {}, "WEWEBPLUS_DATABASE_URL")) {
    throw new Error("Refusing to copy the database URL");
  }
  return copy;
}

export function modelKeysToCopy(source) {
  const copy = {};
  for (const name of modelKeyNames) {
    if (name === "WEWEBPLUS_DATABASE_URL") {
      throw new Error("Refusing to copy the database URL");
    }
    if (present(source, name)) copy[name] = source[name];
  }
  return assertModelKeyCopy(copy);
}

export function absentAutoKeys(source) {
  return autoModelKeyNames.filter((name) => !present(source, name));
}

export function autoKeysAfterCopy(source, destination) {
  return autoModelKeyNames.filter(
    (name) => present(source, name) || present(destination, name),
  );
}
