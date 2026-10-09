// An in-process stand-in for gh. Each call is matched on its first two
// words; the scenario says what gh would have printed.
import { GhError, classify } from "../lib/gh.js";

export function fakeGh(scenario) {
  const calls = [];
  const runner = async (args, { allowFailure = false } = {}) => {
    calls.push(args);
    const key = args.slice(0, 2).join(" ");
    const handler = scenario[key];
    if (!handler)
      throw new Error(`fake gh has no answer for: ${args.join(" ")}`);
    const answer =
      typeof handler === "function" ? handler(args, calls) : handler;
    const result = { status: 0, stdout: "", stderr: "", ...answer };
    if (result.status !== 0 && !allowFailure) {
      throw new GhError(result.stderr.trim(), {
        code: classify(result.stderr),
        stderr: result.stderr,
        status: result.status,
      });
    }
    return result;
  };
  runner.calls = calls;
  return runner;
}

export const RUN = {
  databaseId: 4242,
  createdAt: new Date("2026-10-09T10:00:05Z").toISOString(),
  status: "completed",
  conclusion: "success",
  event: "workflow_dispatch",
  headSha: "5e952bbca6729cfc2383e23f182788a8d3d8cd6b",
  url: "https://github.com/Awannaphasch2016/dyad/actions/runs/4242",
};

export function log(lines) {
  return lines
    .map((line) => `check\tStep name\t2026-10-09T10:01:00.0000000Z ${line}`)
    .join("\n");
}
