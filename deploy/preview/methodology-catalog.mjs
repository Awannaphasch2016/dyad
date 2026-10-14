// Formula ids the Vibe SDK host can store on an app.
// The phase packs are the column-3 formulas from
// https://github.com/Awannaphasch2016/dyad/pull/154
// A pack with steps is runnable here. The host walks those steps. It does not
// sling the upstream Gas City formula.

export const DEFAULT_METHODOLOGY = "speckit-phased";

export const METHODOLOGY_CATALOG = [
  pack(
    "speckit-build",
    "formulas/speckit",
    ["build-base"],
    [
      write(
        "requirements",
        ["spec.md"],
        "Write spec.md for what the product must do. Mark anything unresolved as NEEDS CLARIFICATION. Do not write plan.md, tasks.md, or other files.",
      ),
      wait(
        "clarify",
        "",
        ["spec.md"],
        "If spec.md contains NEEDS CLARIFICATION, call ask_questions with exactly one question. Requirements go to project-manager. Technical choices go to developer. If nothing is unresolved, do not ask and do not write files.",
      ),
      write(
        "plan",
        ["plan.md"],
        "Write plan.md for how to implement spec.md. Do not write tasks or other files.",
      ),
      write(
        "decompose",
        ["tasks.md"],
        "Write tasks.md as checkboxes derived from plan.md. Do not implement them.",
      ),
      implement(
        "implement",
        "Implement tasks.md. You may write the product files, call deploy_space, then get_browser_console_logs.",
      ),
      write(
        "review",
        ["*"],
        "Compare the result with spec.md. Fix a gap the specification already decides. If a person must choose, call ask_questions once. Do not call deploy_space.",
      ),
      write(
        "finalize",
        ["final-report.md"],
        "Write final-report.md covering spec.md, plan.md, tasks.md, and the review.",
      ),
    ],
  ),
  pack(
    "speckit-phased",
    "formulas/speckit",
    ["speckit-build"],
    [
      write(
        "requirements",
        ["spec.md"],
        "Write spec.md for what the product must do. Mark anything unresolved as NEEDS CLARIFICATION. Do not write plan.md, tasks.md, or other files.",
      ),
      wait(
        "clarify",
        "",
        ["spec.md"],
        "If spec.md contains NEEDS CLARIFICATION, call ask_questions with exactly one question. Requirements go to project-manager. Technical choices go to developer. If nothing is unresolved, do not ask and do not write files.",
      ),
      write(
        "plan",
        ["plan.md"],
        "Write plan.md for how to implement spec.md. Do not write tasks or other files.",
      ),
      write(
        "decompose",
        ["tasks.md"],
        "Write tasks.md as checkboxes derived from plan.md. Do not implement them.",
      ),
      wait(
        "accept-discovery",
        "project-manager",
        [],
        "Call ask_questions with exactly one question for the project-manager asking whether to build from spec.md, plan.md, and tasks.md. Do not write files.",
      ),
      implement(
        "implement",
        "Write the shop website pages from tasks.md before calling deploy_space. The preview must show those pages. Then call get_browser_console_logs.",
      ),
      write(
        "review",
        ["*"],
        "Compare the result with spec.md. Fix a gap the specification already decides. If a person must choose, call ask_questions once. Do not call deploy_space.",
      ),
      wait(
        "accept-implementation",
        "project-manager",
        [],
        "Call ask_questions with exactly one question for the project-manager asking whether this implementation is accepted. Do not write files.",
      ),
      write(
        "finalize",
        ["final-report.md"],
        "Write final-report.md covering spec.md, plan.md, tasks.md, and the review.",
      ),
      wait(
        "accept-delivery",
        "project-manager",
        [],
        "Call ask_questions with exactly one question for the project-manager asking whether to publish. Do not write files.",
      ),
      write(
        "publish",
        ["publish.md"],
        "Write publish.md recording the result. Do not deploy a live site. Do not call deploy_space.",
      ),
    ],
  ),
  pack(
    "openspec-build",
    "formulas/openspec",
    ["build-base"],
    [
      write(
        "requirements",
        ["proposal.md"],
        "Write proposal.md for the change. Do not write specs, design, or tasks.",
      ),
      write(
        "specs",
        ["specs/spec.md"],
        "Write specs/spec.md with a scenario for every requirement. Do not write design or tasks.",
      ),
      write("plan", ["design.md"], "Write design.md. Do not write tasks."),
      write(
        "decompose",
        ["tasks.md"],
        "Write tasks.md from the proposal, specs, and design. Do not implement them.",
      ),
      wait(
        "accept-apply",
        "project-manager",
        [],
        "Call ask_questions with exactly one question for the project-manager asking whether to apply the tasks. Do not write files.",
      ),
      implement(
        "implement",
        "Apply tasks.md. You may write the product files, call deploy_space, then get_browser_console_logs.",
      ),
      write(
        "review",
        ["*"],
        "Compare the result with the proposal and specs. Do not call deploy_space.",
      ),
      write(
        "finalize",
        ["final-report.md"],
        "Write final-report.md for the change.",
      ),
      write(
        "archive",
        ["archive.md"],
        "Write archive.md recording the completed change.",
      ),
      write(
        "publish",
        ["publish.md"],
        "Write publish.md recording the result. Do not call deploy_space.",
      ),
    ],
  ),
  pack(
    "openspec-phased",
    "formulas/openspec",
    ["openspec-build"],
    [
      write(
        "requirements",
        ["proposal.md"],
        "Write proposal.md for the change. Do not write specs, design, or tasks.",
      ),
      write(
        "specs",
        ["specs/spec.md"],
        "Write specs/spec.md with a scenario for every requirement. Do not write design or tasks.",
      ),
      write("plan", ["design.md"], "Write design.md. Do not write tasks."),
      write(
        "decompose",
        ["tasks.md"],
        "Write tasks.md from the proposal, specs, and design. Do not implement them.",
      ),
      wait(
        "accept-discovery",
        "project-manager",
        [],
        "Call ask_questions with exactly one question for the project-manager asking whether to build from the proposal, specs, design, and tasks. Do not write files.",
      ),
      implement(
        "implement",
        "Apply tasks.md. You may write the product files, call deploy_space, then get_browser_console_logs.",
      ),
      write(
        "review",
        ["*"],
        "Compare the result with the proposal and specs. Do not call deploy_space.",
      ),
      wait(
        "accept-implementation",
        "project-manager",
        [],
        "Call ask_questions with exactly one question for the project-manager asking whether this implementation is accepted. Do not write files.",
      ),
      write(
        "finalize",
        ["final-report.md"],
        "Write final-report.md for the change.",
      ),
      wait(
        "accept-delivery",
        "project-manager",
        [],
        "Call ask_questions with exactly one question for the project-manager asking whether to publish. Do not write files.",
      ),
      write(
        "archive",
        ["archive.md"],
        "Write archive.md recording the completed change. Do not call deploy_space.",
      ),
      write(
        "publish",
        ["publish.md"],
        "Write publish.md recording the result. Do not call deploy_space.",
      ),
    ],
  ),
  pack(
    "gsd-build",
    "formulas/gsd",
    ["build-base"],
    [
      write(
        "requirements",
        [
          ".planning/PROJECT.md",
          ".planning/REQUIREMENTS.md",
          ".planning/ROADMAP.md",
        ],
        "Write .planning/PROJECT.md, .planning/REQUIREMENTS.md, and .planning/ROADMAP.md. Do not write a plan or product files.",
      ),
      wait(
        "discuss",
        "",
        [".planning/PROJECT.md"],
        "If a product choice is unresolved, call ask_questions with exactly one question. Requirements go to project-manager. Technical choices go to developer. If nothing is unresolved, do not ask.",
      ),
      write(
        "research",
        [".planning/RESEARCH.md"],
        "Write .planning/RESEARCH.md. Do not write a plan or product files.",
      ),
      write(
        "plan",
        [".planning/PLAN.md"],
        "Write .planning/PLAN.md from the requirements and research. Do not implement it.",
      ),
      write(
        "decompose",
        [".planning/tasks.md"],
        "Write .planning/tasks.md as the execution checklist. Do not implement it.",
      ),
      implement(
        "implement",
        "Execute .planning/tasks.md. You may write the product files, call deploy_space, then get_browser_console_logs.",
      ),
      write(
        "review",
        ["*"],
        "Compare the result with .planning/REQUIREMENTS.md. Do not call deploy_space.",
      ),
      wait(
        "verify-work",
        "developer",
        [],
        "Call ask_questions with exactly one question for the developer asking whether the result matches the requirements. Do not write files.",
      ),
      wait(
        "approve-ship",
        "project-manager",
        [],
        "Call ask_questions with exactly one question for the project-manager asking whether to ship. Do not write files.",
      ),
      write(
        "finalize",
        [".planning/VERIFICATION.md"],
        "Write .planning/VERIFICATION.md. Do not call deploy_space.",
      ),
    ],
  ),
  pack(
    "bmad-phased",
    "formulas/bmad-hitl",
    ["bmad-build"],
    [
      write(
        "implementation-readiness",
        ["bmad/readiness.md"],
        "Write bmad/readiness.md for whether the stories are ready to build. Do not write product files.",
      ),
      wait(
        "accept-discovery",
        "project-manager",
        [],
        "Call ask_questions with exactly one question for the project-manager asking whether to start story development. Do not write files.",
      ),
      implement(
        "implement",
        "Develop the stories. You may write the product files, call deploy_space, then get_browser_console_logs.",
      ),
      write(
        "review",
        ["*"],
        "Review the stories against bmad/readiness.md. Do not call deploy_space.",
      ),
      wait(
        "accept-implementation",
        "project-manager",
        [],
        "Call ask_questions with exactly one question for the project-manager asking whether the story development is accepted. Do not write files.",
      ),
      write(
        "finalize",
        ["bmad/final-report.md"],
        "Write bmad/final-report.md. Do not call deploy_space.",
      ),
      wait(
        "accept-delivery",
        "project-manager",
        [],
        "Call ask_questions with exactly one question for the project-manager asking whether to publish. Do not write files.",
      ),
      write(
        "publish",
        ["bmad/publish.md"],
        "Write bmad/publish.md recording the result. Do not call deploy_space.",
      ),
    ],
  ),
  pack(
    "superpowers-phased",
    "formulas/superpowers-hitl",
    ["superpowers-build"],
    [
      write(
        "decompose",
        ["superpowers/spec.md", "superpowers/tasks.md"],
        "Write superpowers/spec.md and superpowers/tasks.md. Do not write product files.",
      ),
      wait(
        "accept-discovery",
        "project-manager",
        [],
        "Call ask_questions with exactly one question for the project-manager asking whether to start implementation. Do not write files.",
      ),
      implement(
        "implement",
        "Implement superpowers/tasks.md. You may write the product files, call deploy_space, then get_browser_console_logs.",
      ),
      write(
        "review",
        ["*"],
        "Review the code against superpowers/spec.md. Do not call deploy_space.",
      ),
      wait(
        "accept-implementation",
        "project-manager",
        [],
        "Call ask_questions with exactly one question for the project-manager asking whether the implementation is accepted. Do not write files.",
      ),
      write(
        "finalize",
        ["superpowers/final-report.md"],
        "Write superpowers/final-report.md. Do not call deploy_space.",
      ),
      wait(
        "accept-delivery",
        "project-manager",
        [],
        "Call ask_questions with exactly one question for the project-manager asking whether to publish. Do not write files.",
      ),
      write(
        "publish",
        ["superpowers/publish.md"],
        "Write superpowers/publish.md recording the result. Do not call deploy_space.",
      ),
    ],
  ),
  pack(
    "gstack-phased",
    "formulas/gstack-hitl",
    ["gstack-build"],
    [
      write(
        "decompose",
        ["gstack/plan.md"],
        "Write gstack/plan.md. Do not write product files.",
      ),
      wait(
        "accept-discovery",
        "project-manager",
        [],
        "Call ask_questions with exactly one question for the project-manager asking whether to start implementation. Do not write files.",
      ),
      implement(
        "implement",
        "Implement gstack/plan.md. You may write the product files, call deploy_space, then get_browser_console_logs.",
      ),
      write(
        "review",
        ["*"],
        "Review the result against gstack/plan.md. Do not call deploy_space.",
      ),
      wait(
        "accept-implementation",
        "project-manager",
        [],
        "Call ask_questions with exactly one question for the project-manager asking whether the implementation is accepted. Do not write files.",
      ),
      write(
        "qa",
        ["gstack/qa.md"],
        "Write gstack/qa.md for the checks that still fail. Do not call deploy_space.",
      ),
      write(
        "sprint-report",
        ["gstack/sprint-report.md"],
        "Write gstack/sprint-report.md. Do not call deploy_space.",
      ),
      wait(
        "accept-delivery",
        "project-manager",
        [],
        "Call ask_questions with exactly one question for the project-manager asking whether to publish. Do not write files.",
      ),
      write(
        "publish",
        ["gstack/publish.md"],
        "Write gstack/publish.md recording the result. Do not call deploy_space.",
      ),
    ],
  ),
  pack(
    "compound-phased",
    "formulas/compound-hitl",
    ["compound-build"],
    [
      write(
        "decompose",
        ["compound/tasks.md"],
        "Write compound/tasks.md. Do not write product files.",
      ),
      wait(
        "accept-discovery",
        "project-manager",
        [],
        "Call ask_questions with exactly one question for the project-manager asking whether to start the work. Do not write files.",
      ),
      implement(
        "implement",
        "Carry out compound/tasks.md. You may write the product files, call deploy_space, then get_browser_console_logs.",
      ),
      write(
        "review",
        ["*"],
        "Review the result against compound/tasks.md. Do not call deploy_space.",
      ),
      wait(
        "accept-implementation",
        "project-manager",
        [],
        "Call ask_questions with exactly one question for the project-manager asking whether the work is accepted. Do not write files.",
      ),
      write(
        "finalize",
        ["compound/final-report.md"],
        "Write compound/final-report.md. Do not call deploy_space.",
      ),
      wait(
        "accept-delivery",
        "project-manager",
        [],
        "Call ask_questions with exactly one question for the project-manager asking whether to publish. Do not write files.",
      ),
      write(
        "publish",
        ["compound/publish.md"],
        "Write compound/publish.md recording the result. Do not call deploy_space.",
      ),
    ],
  ),
  pack(
    "build-basic-phased",
    "formulas/build-basic-hitl",
    ["build-basic"],
    [
      write(
        "decompose",
        ["build-basic/tasks.md"],
        "Write build-basic/tasks.md. Do not write product files.",
      ),
      wait(
        "accept-discovery",
        "project-manager",
        [],
        "Call ask_questions with exactly one question for the project-manager asking whether to start implementation. Do not write files.",
      ),
      implement(
        "implement",
        "Carry out build-basic/tasks.md. You may write the product files, call deploy_space, then get_browser_console_logs.",
      ),
      write(
        "review",
        ["*"],
        "Review the result against build-basic/tasks.md. Do not call deploy_space.",
      ),
      wait(
        "accept-implementation",
        "project-manager",
        [],
        "Call ask_questions with exactly one question for the project-manager asking whether the implementation is accepted. Do not write files.",
      ),
      write(
        "finalize",
        ["build-basic/final-report.md"],
        "Write build-basic/final-report.md. Do not call deploy_space.",
      ),
      wait(
        "accept-delivery",
        "project-manager",
        [],
        "Call ask_questions with exactly one question for the project-manager asking whether to publish. Do not write files.",
      ),
      write(
        "publish",
        ["build-basic/publish.md"],
        "Write build-basic/publish.md recording the result. Do not call deploy_space.",
      ),
    ],
  ),
];

function write(id, artifacts, instruction) {
  return { id, kind: "write", role: "", artifacts, instruction };
}

function wait(id, role, artifacts, instruction) {
  return { id, kind: "wait", role, artifacts, instruction };
}

function implement(id, instruction) {
  return { id, kind: "implement", role: "", artifacts: ["*"], instruction };
}

function pack(id, directory, bases, steps) {
  const file = `${directory}/formulas/${id}.formula.toml`;
  const runnable = steps.length > 0;
  return { id, pack: directory, file, extends: bases, runnable, steps };
}

export function resolveMethodology(id) {
  const name =
    typeof id === "string" && id.trim() ? id.trim() : DEFAULT_METHODOLOGY;
  const record = METHODOLOGY_CATALOG.find((item) => item.id === name);
  if (!record)
    return { ok: false, message: `Unknown methodology pack: ${name}` };
  if (!record.runnable)
    return { ok: false, message: `Methodology pack is not imported: ${name}` };
  return { ok: true, record };
}

export function stepAt(record, stepId) {
  return record.steps.find((step) => step.id === stepId) ?? record.steps[0];
}

export function nextStepId(record, stepId, reason) {
  const index = record.steps.findIndex((step) => step.id === stepId);
  const step = index >= 0 ? record.steps[index] : record.steps[0];
  const advance =
    (reason === "answer" && (step.kind === "wait" || step.kind === "write")) ||
    (reason === "turn" && (step.kind === "write" || step.kind === "wait")) ||
    (reason === "deploy" && step.kind === "implement");
  if (!advance) return step.id;
  return record.steps[index + 1]?.id ?? step.id;
}

export function writeAdvances(record, stepId, input) {
  const step = stepAt(record, stepId);
  if (
    step.kind !== "write" ||
    step.artifacts.length !== 1 ||
    step.artifacts[0] === "*"
  )
    return false;
  const path = toolPath(input);
  const artifact = step.artifacts[0];
  return path === artifact || path.endsWith(`/${artifact}`);
}

export function toolDecision(record, stepId, tool, input) {
  const step = stepAt(record, stepId);
  if (tool === "ask_questions") {
    if (
      step.kind === "write" &&
      step.artifacts.length > 0 &&
      !step.artifacts.includes("*")
    ) {
      return {
        allow: false,
        message: `Write ${step.artifacts.join(", ")} before asking a question.`,
      };
    }
    return { allow: true, message: "" };
  }
  if (tool === "deploy_space") {
    if (step.kind === "implement") return { allow: true, message: "" };
    return {
      allow: false,
      message: "deploy_space is not available on this step.",
    };
  }
  if (tool !== "write" && tool !== "edit" && tool !== "delete")
    return { allow: true, message: "" };
  if (step.artifacts.includes("*")) return { allow: true, message: "" };
  const path = toolPath(input);
  if (
    step.artifacts.some(
      (artifact) => path === artifact || path.endsWith(`/${artifact}`),
    )
  ) {
    return { allow: true, message: "" };
  }
  const allowed =
    step.artifacts.length > 0 ? step.artifacts.join(", ") : "no files";
  return { allow: false, message: `This step only writes: ${allowed}` };
}

function toolPath(input) {
  if (!input || typeof input !== "object") return "";
  const record = input;
  for (const key of ["path", "filePath", "file"]) {
    if (typeof record[key] === "string")
      return record[key].replace(/^\.\//, "");
  }
  return "";
}

export function stepPrompt(record, stepId) {
  const step = stepAt(record, stepId);
  const files = step.artifacts.includes("*")
    ? "the product files"
    : step.artifacts.length > 0
      ? step.artifacts.join(", ")
      : "no files";
  const deploy =
    step.kind === "implement"
      ? "deploy_space is allowed."
      : "Do not call deploy_space.";
  const role = step.role ? `Address the question to ${step.role}.` : "";
  const follow =
    step.kind === "write"
      ? "When the tool result names a new current step, follow that step before you end the turn."
      : "";
  return [
    `## Current step`,
    step.instruction,
    `Write only: ${files}`,
    deploy,
    role,
    follow,
  ]
    .filter(Boolean)
    .join("\n");
}

export function methodologyModuleSource() {
  return `// Generated from deploy/preview/methodology-catalog.mjs
// @ts-nocheck
export const DEFAULT_METHODOLOGY = ${JSON.stringify(DEFAULT_METHODOLOGY)};
export const CATALOG = ${JSON.stringify(METHODOLOGY_CATALOG, null, 2)};

type MethodologyRecord = (typeof CATALOG)[number];
type MethodologyStep = MethodologyRecord["steps"][number];

export function resolveMethodology(id: string | undefined) {
  const name = typeof id === "string" && id.trim() ? id.trim() : DEFAULT_METHODOLOGY;
  const record = CATALOG.find((item) => item.id === name);
  if (!record) return { ok: false as const, message: "Unknown methodology pack: " + name };
  if (!record.runnable) return { ok: false as const, message: "Methodology pack is not imported: " + name };
  return { ok: true as const, record };
}

function asDatabase(env: unknown): DatabaseEnv {
  return env as DatabaseEnv;
}

export function assertRunnableMethodology(env: unknown) {
  const resolved = resolveMethodology(asDatabase(env).VIBESDK_METHODOLOGY);
  if (!resolved.ok) throw new Error(resolved.message);
  return resolved.record;
}

function stepAt(record: MethodologyRecord, stepId: string): MethodologyStep {
  return record.steps.find((step) => step.id === stepId) ?? record.steps[0];
}

export function nextStepId(record: MethodologyRecord, stepId: string, reason: string) {
  const index = Math.max(0, record.steps.findIndex((step) => step.id === stepId));
  const step = record.steps[index];
  const advance =
    (reason === "answer" && (step.kind === "wait" || step.kind === "write")) ||
    (reason === "turn" && (step.kind === "write" || step.kind === "wait")) ||
    (reason === "deploy" && step.kind === "implement");
  if (!advance) return step.id;
  return record.steps[index + 1]?.id ?? step.id;
}

function toolPath(input: unknown) {
  if (!input || typeof input !== "object") return "";
  const record = input as Record<string, unknown>;
  for (const key of ["path", "filePath", "file"]) {
    if (typeof record[key] === "string") return record[key].replace(/^\\.\\//, "");
  }
  return "";
}

function writeAdvances(step: MethodologyStep, input: unknown) {
  if (step.kind !== "write" || step.artifacts.length !== 1 || step.artifacts[0] === "*") return false;
  const path = toolPath(input);
  const artifact = step.artifacts[0];
  return path === artifact || path.endsWith("/" + artifact);
}

export function toolDecision(record: MethodologyRecord, stepId: string, tool: string, input: unknown) {
  const step = stepAt(record, stepId);
  if (tool === "ask_questions") {
    if (step.kind === "write" && step.artifacts.length > 0 && !step.artifacts.includes("*")) {
      return { allow: false, message: "Write " + step.artifacts.join(", ") + " before asking a question." };
    }
    return { allow: true, message: "" };
  }
  if (tool === "deploy_space") {
    if (step.kind === "implement") return { allow: true, message: "" };
    return { allow: false, message: "deploy_space is not available on this step." };
  }
  if (tool !== "write" && tool !== "edit" && tool !== "delete") return { allow: true, message: "" };
  if (step.artifacts.includes("*")) return { allow: true, message: "" };
  const path = toolPath(input);
  if (step.artifacts.some((artifact) => path === artifact || path.endsWith("/" + artifact))) {
    return { allow: true, message: "" };
  }
  const allowed = step.artifacts.length > 0 ? step.artifacts.join(", ") : "no files";
  return { allow: false, message: "This step only writes: " + allowed };
}

export function stepPrompt(record: MethodologyRecord, stepId: string) {
  const step = stepAt(record, stepId);
  const files = step.artifacts.includes("*") ? "the product files" : step.artifacts.length > 0 ? step.artifacts.join(", ") : "no files";
  const deploy = step.kind === "implement" ? "deploy_space is allowed." : "Do not call deploy_space.";
  const role = step.role ? "Address the question to " + step.role + "." : "";
  const follow = step.kind === "write" ? "When the tool result names a new current step, follow that step before you end the turn." : "";
  return ["## Current step", step.instruction, "Write only: " + files, deploy, role, follow].filter(Boolean).join("\\n");
}

type DatabaseEnv = {
  DB: D1Database;
  VIBESDK_METHODOLOGY?: string;
};

async function readStored(env: DatabaseEnv, appId: string) {
  try {
    return await env.DB.prepare("SELECT methodology, methodology_step FROM apps WHERE id = ?").bind(appId).first<{ methodology: string | null; methodology_step: string | null }>();
  } catch {
    return null;
  }
}

export async function methodologyStepId(env: unknown, appId: string) {
  const database = asDatabase(env);
  const stored = await readStored(database, appId);
  const resolved = resolveMethodology(stored?.methodology || database.VIBESDK_METHODOLOGY);
  if (!resolved.ok) return "";
  return stored?.methodology_step || resolved.record.steps[0].id;
}

export async function methodologyStepPrompt(env: unknown, appId: string) {
  const database = asDatabase(env);
  const stored = await readStored(database, appId);
  const resolved = resolveMethodology(stored?.methodology || database.VIBESDK_METHODOLOGY);
  if (!resolved.ok) return "";
  const stepId = stored?.methodology_step || resolved.record.steps[0].id;
  return "\\n\\n" + stepPrompt(resolved.record, stepId);
}

export async function advanceMethodology(env: unknown, appId: string, reason: string) {
  const database = asDatabase(env);
  const stored = await readStored(database, appId);
  const resolved = resolveMethodology(stored?.methodology || database.VIBESDK_METHODOLOGY);
  if (!resolved.ok || !stored?.methodology_step) return;
  const next = nextStepId(resolved.record, stored.methodology_step, reason);
  if (next === stored.methodology_step) return;
  await database.DB.prepare("UPDATE apps SET methodology_step = ? WHERE id = ?").bind(next, appId).run();
}

export async function methodologyToolDecision(env: unknown, appId: string, tool: string, input: unknown) {
  const database = asDatabase(env);
  const stored = await readStored(database, appId);
  const resolved = resolveMethodology(stored?.methodology || database.VIBESDK_METHODOLOGY);
  if (!resolved.ok) return { allow: false, message: resolved.message };
  const stepId = stored?.methodology_step || resolved.record.steps[0].id;
  const step = stepAt(resolved.record, stepId);
  const decision = toolDecision(resolved.record, stepId, tool, input);
  if (decision.allow && writeAdvances(step, input)) {
    await advanceMethodology(database, appId, "turn");
    const nextId = await methodologyStepId(database, appId);
    return { allow: true, message: "", followUp: stepPrompt(resolved.record, nextId) + "\\nFollow this step now, before ending the turn." };
  }
  return { ...decision, followUp: "" };
}
`;
}
