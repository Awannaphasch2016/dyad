// Read the parts of a workflow file the contract tests lock: triggers,
// workflow_dispatch inputs, and whether permissions are declared. This is a
// test helper. It is not a workflow runner.

export function parseWorkflowOn(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(
    (line) => line === "on:" || line.startsWith("on:"),
  );
  if (start < 0) {
    return {
      triggers: [],
      inputs: [],
      required: [],
      types: [],
      permissions: hasPermissions(text),
    };
  }
  if (lines[start] !== "on:") {
    return {
      triggers: [lines[start].slice("on:".length).trim()],
      inputs: [],
      required: [],
      types: [],
      permissions: hasPermissions(text),
    };
  }
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (
      line !== "" &&
      !line.startsWith("#") &&
      !line.startsWith(" ") &&
      !line.startsWith("\t")
    ) {
      end = index;
      break;
    }
  }
  const block = lines.slice(start, end);
  const triggers = [];
  for (const line of block) {
    const match = /^  ([A-Za-z0-9_]+):/.exec(line);
    if (match) triggers.push(match[1]);
  }
  const inputs = [];
  const required = [];
  let current = null;
  let inInputs = false;
  for (const line of block) {
    if (line === "    inputs:") {
      inInputs = true;
      continue;
    }
    if (inInputs && /^    [A-Za-z]/.test(line)) inInputs = false;
    if (!inInputs) continue;
    const key = /^      ([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (key) {
      current = key[1];
      inputs.push(current);
      continue;
    }
    if (current && /required:\s*true/.test(line)) required.push(current);
  }
  const types = [];
  for (const line of block) {
    const bracket = /^\s+types:\s*\[([^\]]+)\]/.exec(line);
    if (bracket) {
      types.push(...bracket[1].split(",").map((item) => item.trim()));
    }
  }
  return {
    triggers,
    inputs,
    required,
    types,
    permissions: hasPermissions(text),
  };
}

function hasPermissions(text) {
  return /^permissions:/m.test(text);
}
