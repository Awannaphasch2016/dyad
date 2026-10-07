// The vibesdk Doppler project is its own lab.
// It does not inherit a dyad config and this module never copies secret values.

export const VIBESDK_PROJECT_NAME = "vibesdk";

export function projectBody() {
  return {
    name: VIBESDK_PROJECT_NAME,
    description: "Isolated VibeSDK lab. Secrets are not inherited from dyad.",
  };
}

export function redact(text) {
  return String(text)
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://redacted")
    .replace(/dp\.(?:st|pt|sa|ct|said)\.[A-Za-z0-9._-]+/g, "dp.redacted")
    .replace(/\bsk-or-[A-Za-z0-9_-]+/g, "sk-or-redacted")
    .replace(/\bnapi_[A-Za-z0-9_-]+/g, "napi_redacted")
    .slice(0, 180);
}

export function inheritsLabel(config) {
  const value = config?.inherits;
  if (value == null || value === false || value === "") return "none";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const labels = value.map((item) => inheritsLabel({ inherits: item }));
    return labels.filter((label) => label !== "none").join(",") || "none";
  }
  if (typeof value === "object") {
    const name =
      value.name ??
      value.slug ??
      value.config ??
      value.config_name ??
      value.environment;
    if (typeof name === "string" && name) return name;
    const keys = Object.keys(value).sort();
    return keys.length === 0 ? "none" : `unparsed:${keys.join("+")}`;
  }
  return typeof value;
}

export function configReport(configs) {
  return (configs ?? [])
    .map((config) => {
      const name = String(config?.name ?? "");
      if (!name) return "";
      return `config=${name} inherits=${inheritsLabel(config)}`;
    })
    .filter(Boolean);
}

export function dyadDevStatus(configs) {
  const present = (configs ?? []).some((config) => config?.name === "dev");
  return present ? "present" : "absent";
}
