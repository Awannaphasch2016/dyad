export function parseArgs(args, spec) {
  const positionals = [];
  const flags = {};
  const unknown = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--") {
      positionals.push(...args.slice(index + 1));
      break;
    }
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const body = token.slice(2);
    const eq = body.indexOf("=");
    const name = eq === -1 ? body : body.slice(0, eq);
    if (!Object.hasOwn(spec, name)) {
      unknown.push(token);
      continue;
    }
    if (spec[name] === "boolean") {
      if (eq !== -1) unknown.push(token);
      else flags[name] = true;
      continue;
    }
    const value = eq === -1 ? args[index + 1] : body.slice(eq + 1);
    if (eq === -1) index += 1;
    if (!value || value.startsWith("--")) {
      unknown.push(token);
      continue;
    }
    flags[name] = value;
  }
  return { positionals, flags, unknown };
}

export function unknownFlagError(unknown, spec) {
  if (unknown.length === 0) return null;
  const valid = Object.keys(spec).map((name) => `--${name}`);
  return {
    message: `Unknown flag: ${unknown[0]}`,
    code: "VALIDATION_ERROR",
    suggestions: [
      valid.length
        ? `Valid flags: ${valid.join(", ")}`
        : "This command takes no flags",
    ],
  };
}
