// Pass/fail gates for the canary named pre. A pass does not promote.

export const canaryEndpoint = "ep-muddy-sky-b31adt7z";
export const productionEndpoint = "ep-young-wave-b3cwe0rz";
export const hitlPrdBranchEndpoint = "ep-royal-term-b3paoprp";

const forbiddenMounts = [
  "/opt/gascity",
  "/opt/gascity/city",
  "/opt/gascity/projects",
  "weaver-plus_weaver-plus-user-data",
];

const publicPorts = [32100, 6080, 8373];

export function bareEndpoint(label) {
  const host = String(label || "").split(".")[0];
  return host.endsWith("-pooler") ? host.slice(0, -"-pooler".length) : host;
}

function gate(gates, name, pass, detail) {
  gates.push({
    name,
    status: pass ? "pass" : "fail",
    detail: detail || "",
  });
}

function supervisorFails(supervisor) {
  const text = `${supervisor.argv || ""} ${supervisor.target || ""}`;
  if (/\bsleep\b/.test(text) || text.includes("server.mjs"))
    return "preview stand-in";
  if ((supervisor.listeners || []).includes(8787)) return "port 8787";
  if (supervisor.target !== "dyad:32100")
    return supervisor.target || "missing target";
  return "";
}

export function evaluatePrePromotion(report) {
  const gates = [];
  const canary = bareEndpoint(report.canaryHost);
  const production = bareEndpoint(report.prdHost);
  gate(
    gates,
    "Canary database host",
    canary === canaryEndpoint,
    canary || "absent",
  );
  gate(
    gates,
    "Production database host",
    production === productionEndpoint,
    production || "absent",
  );
  gate(
    gates,
    "Canary and production hosts differ",
    Boolean(canary) && canary !== production,
    "",
  );
  gate(
    gates,
    "Not the Wewebplus-hitl prd branch",
    canary !== hitlPrdBranchEndpoint,
    "",
  );

  const task = report.task;
  if (!task) {
    gate(gates, "ECS task", false, "not started");
  } else {
    gate(
      gates,
      "desiredCount",
      task.desiredCount === 1,
      String(task.desiredCount),
    );
    gate(
      gates,
      "shared memory",
      task.sharedMemory === 1024,
      String(task.sharedMemory),
    );
    const mounts = task.mounts || [];
    const blocked = mounts.filter((mount) =>
      forbiddenMounts.some(
        (forbidden) => mount === forbidden || mount.startsWith(`${forbidden}/`),
      ),
    );
    gate(
      gates,
      "canary volumes",
      blocked.length === 0,
      blocked.join(",") || "task volumes",
    );
    const supervisorProblem = supervisorFails(task.supervisor || {});
    gate(
      gates,
      "GasCity supervisor",
      supervisorProblem === "",
      supervisorProblem || "dyad:32100",
    );
    const open = (task.publicPorts || []).filter((port) =>
      publicPorts.includes(port),
    );
    gate(
      gates,
      "public ports closed",
      open.length === 0,
      open.join(",") || "closed",
    );
  }

  gate(
    gates,
    "Vercel question routes",
    report.questionRoutesPresent === false,
    report.questionRoutesPresent ? "present" : "absent",
  );

  const probe = report.probe;
  if (!probe) {
    gate(gates, "canary question", false, "not started");
  } else {
    gate(
      gates,
      "Origin rejected",
      probe.originStatus === 403,
      String(probe.originStatus),
    );
    gate(
      gates,
      "missing bearer",
      probe.unauthStatus === 401,
      String(probe.unauthStatus),
    );
    gate(
      gates,
      "question on pre only",
      probe.onPreBranch === true && probe.onProduction === false,
      "",
    );
    gate(gates, "answer resolved false", probe.resolved === false, "");
    gate(gates, "apex unchanged", probe.apexUnchanged === true, "");
  }

  const failed = gates.filter((item) => item.status === "fail");
  return {
    pass: failed.length === 0,
    promotionPerformed: false,
    gates,
  };
}

export function formatVerdict(result) {
  const lines = result.gates.map(
    (item) =>
      `${item.status} ${item.name}${item.detail ? ` ${item.detail}` : ""}`,
  );
  const failed = result.gates.filter((item) => item.status === "fail");
  if (failed.length > 0) {
    lines.push(`Gate failed: ${failed[0].name}`);
  }
  lines.push("promotion was not performed");
  return lines.join("\n");
}
