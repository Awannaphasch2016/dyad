import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPLETE,
  CONTINUED,
  DEV_QUESTION,
  DEV_ROLE,
  PM_QUESTION,
  PM_ROLE,
  WAITING_DEV,
  WAITING_PM,
  assignRole,
  decideAnswer,
  hitlControllerSource,
  hitlPanelSource,
  patchHome,
  patchRouteIndex,
  presentQuestion,
  reduceAnswer,
  sharedLines,
} from "./vibesdk-hitl.mjs";

const open = (role, body) => ({ status: "open", targetRole: role, body });

test("a missing role is kept for the project manager and marked fallback", () => {
  assert.deepEqual(assignRole(undefined), {
    targetRole: PM_ROLE,
    assignment: "fallback",
  });
  assert.deepEqual(assignRole("architect"), {
    targetRole: PM_ROLE,
    assignment: "fallback",
  });
  assert.equal(assignRole(DEV_ROLE).assignment, "declared");
});

test("the other role sees a waiting line and cannot answer", () => {
  const question = open(PM_ROLE, PM_QUESTION);
  assert.deepEqual(presentQuestion(question, DEV_ROLE), {
    body: null,
    canAnswer: false,
    waiting: WAITING_PM,
  });
  assert.equal(decideAnswer(question, DEV_ROLE), "forbidden");
  assert.equal(presentQuestion(question, PM_ROLE).body, PM_QUESTION);
  assert.equal(decideAnswer(question, PM_ROLE), "allow");
});

test("the project manager answer resumes into a developer question", () => {
  const step = reduceAnswer(open(PM_ROLE, PM_QUESTION), PM_ROLE, "North Pier Fish");
  assert.equal(step.decision, "allow");
  assert.equal(step.agentStatus, "running");
  assert.equal(step.shared, CONTINUED);
  assert.match(step.prompt, /North Pier Fish/);
  assert.match(step.prompt, new RegExp(PM_QUESTION));
  assert.equal(step.next.body, DEV_QUESTION);
  assert.equal(step.next.targetRole, DEV_ROLE);
  assert.deepEqual(sharedLines("running"), [CONTINUED]);
});

test("the developer answer completes the run without another question", () => {
  const step = reduceAnswer(open(DEV_ROLE, DEV_QUESTION), DEV_ROLE, "index.html");
  assert.equal(step.agentStatus, "completed");
  assert.equal(step.next, null);
  assert.equal(step.shared, COMPLETE);
  assert.match(step.prompt, /index\.html/);
  assert.equal(decideAnswer({ status: "answered", targetRole: DEV_ROLE }, DEV_ROLE), "closed");
  assert.deepEqual(sharedLines("completed"), [COMPLETE]);
  assert.deepEqual(sharedLines("waiting"), []);
});

test("the preview pages mount the organization run", () => {
  const routes = patchRouteIndex(
    "import { setupAuthRoutes } from './authRoutes';\nexport function setupRoutes(app) {\n    setupAuthRoutes(app);\n}\n",
  );
  assert.match(routes, /setupHitlRoutes\(app\)/);
  const home = patchHome(
    "import { PromptBox } from '@/components/prompt-box';\n\t\t\t\t\t\t</div>\n\t\t\t\t\t\t<PromptBox\n",
  );
  assert.match(home, /<HitlRun \/>/);
  const panel = hitlPanelSource();
  const controller = hitlControllerSource();
  assert.match(panel, /Start the scripted build/);
  assert.match(panel, /Waiting for the Project Manager to start/);
  assert.match(controller, /Waiting on the Project Manager\./);
  assert.doesNotMatch(panel, /Discovery|Implementation|Delivery/);
  assert.match(controller, new RegExp(PM_QUESTION.replace("?", "\\?")));
  assert.match(controller, /'declared'/);
  assert.match(controller, /Forbidden/);
});
