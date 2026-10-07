import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import {
  bareEndpoint,
  evaluatePrePromotion,
  formatVerdict,
} from "./pre-promotion-verdict.mjs";

const readyTask = {
  desiredCount: 1,
  sharedMemory: 1024,
  mounts: ["canary-user-data"],
  supervisor: { argv: "gc supervisor", target: "dyad:32100", listeners: [] },
  publicPorts: [],
};

const readyProbe = {
  originStatus: 403,
  unauthStatus: 401,
  onPreBranch: true,
  onProduction: false,
  resolved: false,
  apexUnchanged: true,
};

function readyReport(overrides = {}) {
  return {
    canaryHost: "ep-muddy-sky-b31adt7z-pooler",
    prdHost: "ep-young-wave-b3cwe0rz-pooler",
    questionRoutesPresent: false,
    task: readyTask,
    probe: readyProbe,
    ...overrides,
  };
}

test("pooler labels reduce to the endpoint id", () => {
  assert.equal(
    bareEndpoint("ep-muddy-sky-b31adt7z-pooler"),
    "ep-muddy-sky-b31adt7z",
  );
  assert.equal(
    bareEndpoint("ep-young-wave-b3cwe0rz"),
    "ep-young-wave-b3cwe0rz",
  );
});

test("a complete canary report passes and does not promote", () => {
  const result = evaluatePrePromotion(readyReport());
  assert.equal(result.pass, true);
  assert.equal(result.promotionPerformed, false);
  assert.match(formatVerdict(result), /promotion was not performed/);
  assert.doesNotMatch(formatVerdict(result), /Gate failed:/);
});

test("production and the other prd branch cannot pass as the canary", () => {
  for (const canaryHost of [
    "ep-young-wave-b3cwe0rz-pooler",
    "ep-royal-term-b3paoprp",
    "ep-wild-paper-b3yf26si-pooler",
  ]) {
    const result = evaluatePrePromotion(readyReport({ canaryHost }));
    assert.equal(result.pass, false);
    assert.match(formatVerdict(result), /Gate failed: Canary database host/);
  }
});

test("the canary fails closed before a task or a question exists", () => {
  const result = evaluatePrePromotion(
    readyReport({ task: undefined, probe: undefined }),
  );
  assert.equal(result.pass, false);
  const text = formatVerdict(result);
  assert.match(text, /fail ECS task not started/);
  assert.match(text, /fail canary question not started/);
});

test("live EC2 mounts, the preview stand-in, and a resolved answer fail", () => {
  const mounted = evaluatePrePromotion(
    readyReport({
      task: { ...readyTask, mounts: ["/opt/gascity/projects"] },
    }),
  );
  assert.match(formatVerdict(mounted), /Gate failed: canary volumes/);

  const sleeping = evaluatePrePromotion(
    readyReport({
      task: {
        ...readyTask,
        supervisor: { argv: "sleep infinity", target: "", listeners: [8787] },
      },
    }),
  );
  assert.match(formatVerdict(sleeping), /Gate failed: GasCity supervisor/);

  const resolved = evaluatePrePromotion(
    readyReport({ probe: { ...readyProbe, resolved: true } }),
  );
  assert.match(formatVerdict(resolved), /Gate failed: answer resolved false/);
});

test("the Vercel question routes are not a writer", () => {
  const present = evaluatePrePromotion(
    readyReport({ questionRoutesPresent: true }),
  );
  assert.match(formatVerdict(present), /Gate failed: Vercel question routes/);
  assert.equal(
    existsSync(
      new URL("../../hitl-web/app/api/questions/route.ts", import.meta.url),
    ),
    false,
  );
  assert.equal(
    existsSync(
      new URL(
        "../../hitl-web/app/api/questions/[id]/answers/route.ts",
        import.meta.url,
      ),
    ),
    false,
  );
});
