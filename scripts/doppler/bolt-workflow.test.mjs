import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SQL, applyBoltHitlPatches } from "./bolt-hitl.mjs";
import {
  applyBoltWorkflowPatches,
  canSendPrompt,
  deliveryDocument,
  handleProject,
  nextPhase,
  presentSnapshot,
  workflowServerSource,
  WORKFLOW_SQL,
} from "./bolt-workflow.mjs";

const env = {
  WEWEBPLUS_DATABASE_URL: "postgres://user:secret@ep.example.neon.tech/neondb",
  GAS_CITY_HOST_BRIDGE_TOKEN: "machine-token",
};

function memory() {
  const project = {
    app_id: "bolt-walkthrough",
    phase: "discovery",
    document_html: null,
    busy: false,
  };
  const messages = [];
  const questions = [
    {
      id: "discovery-q",
      org_id: "org_wewebplus",
      app_id: "bolt-walkthrough",
      phase: "discovery",
      step_id: "plan-approve",
      target_role_id: "project-manager",
      visibility: "role",
      status: "answered",
      body: "Approve the Discovery plan.",
      idempotency_key: "bolt-walkthrough:discovery:plan-approve",
      answered_by_name: "Anak",
    },
  ];
  const answers = [];
  const apps = [
    {
      id: "bolt-walkthrough",
      owner_type: "org",
      owner_id: "org_wewebplus",
    },
  ];
  const memberships = [
    {
      user_id: "user_pm",
      org_id: "org_wewebplus",
      role_id: "project-manager",
    },
    { user_id: "user_dev", org_id: "org_wewebplus", role_id: "developer" },
  ];
  return {
    project,
    messages,
    questions,
    answers,
    async query(sql, params) {
      if (sql === SQL.app) return apps.filter((app) => app.id === params[0]);
      if (sql === SQL.membership) {
        return memberships.filter(
          (row) => row.user_id === params[0] && row.org_id === params[1],
        );
      }
      if (sql === WORKFLOW_SQL.project) {
        return project.app_id === params[0] ? [project] : [];
      }
      if (sql === WORKFLOW_SQL.messages) {
        return messages.filter((row) => row.chat_id === params[0]);
      }
      if (sql === WORKFLOW_SQL.insertMessage) {
        messages.push({
          id: params[0],
          chat_id: params[1],
          role: params[2],
          content: params[3],
        });
        return [];
      }
      if (sql === WORKFLOW_SQL.lockPrompt) {
        if (
          project.app_id === params[0] &&
          !project.busy &&
          project.phase === "discovery"
        ) {
          project.busy = true;
          return [{ app_id: project.app_id }];
        }
        return [];
      }
      if (sql === WORKFLOW_SQL.unlockPrompt) {
        project.busy = false;
        return [];
      }
      if (sql === WORKFLOW_SQL.casPhase) {
        if (project.app_id !== params[0] || project.phase !== params[2]) {
          return [];
        }
        project.phase = params[1];
        if (params[1] === "delivered") project.document_html = params[3];
        return [{ phase: project.phase }];
      }
      if (sql === WORKFLOW_SQL.questions) {
        return questions.filter(
          (row) => row.org_id === params[0] && row.app_id === params[1],
        );
      }
      if (sql === SQL.insertQuestion) {
        if (
          questions.some(
            (row) =>
              row.org_id === params[1] && row.idempotency_key === params[8],
          )
        ) {
          return [];
        }
        questions.push({
          id: params[0],
          org_id: params[1],
          app_id: params[2],
          phase: params[3],
          run_id: params[4],
          step_id: params[5],
          target_role_id: params[6],
          visibility: "role",
          status: "open",
          body: params[7],
          idempotency_key: params[8],
          answered_by_name: null,
        });
        return [];
      }
      if (sql === SQL.questionById) {
        return questions.filter((row) => row.id === params[0]);
      }
      if (sql === SQL.markAnswered) {
        const row = questions.find(
          (item) => item.id === params[0] && item.status === "open",
        );
        if (!row) return [];
        row.status = "answered";
        row.answered_by_user_id = params[1];
        row.answered_by_name = params[2];
        return [{ id: row.id }];
      }
      if (sql === SQL.insertAnswer) {
        if (answers.some((row) => row.question_id === params[1])) return [];
        answers.push({
          id: params[0],
          question_id: params[1],
          body: params[3],
        });
        return [];
      }
      throw new Error(sql);
    },
  };
}

function call(store, userId, extra = {}) {
  return handleProject({
    authorization: "Bearer session",
    env,
    query: store.query,
    verifySession: async () => ({ userId }),
    clerkOrgIds: async () => ["org_wewebplus"],
    displayName: async () => (userId === "user_pm" ? "Anak" : "Dev"),
    ...extra,
  });
}

test("only the matching role changes the phase", () => {
  assert.equal(nextPhase("discovery", "project-manager"), "implementation");
  assert.equal(nextPhase("discovery", "developer"), null);
  assert.equal(nextPhase("implementation", "developer"), "delivery");
  assert.equal(nextPhase("implementation", "project-manager"), null);
  assert.equal(nextPhase("delivery", "project-manager"), "delivered");
  assert.equal(nextPhase("delivery", "developer"), null);
  assert.equal(canSendPrompt("discovery", "developer"), false);
  assert.equal(canSendPrompt("implementation", "project-manager"), false);
});

test("the snapshot hides the seeded discovery question", () => {
  const view = presentSnapshot({
    phase: "discovery",
    roleId: "project-manager",
    documentHtml: null,
    messages: [{ role: "user", content: "North Pier Fish" }],
    questions: [
      {
        id: "old",
        phase: "discovery",
        stepId: "plan-approve",
        targetRoleId: "project-manager",
        status: "answered",
        body: "Approve the Discovery plan.",
        answeredByName: "Anak",
      },
    ],
  });
  assert.deepEqual(view.questions, []);
  assert.equal(view.canSend, true);
  assert.equal(view.transitionLabel, "Move to Implementation");
  assert.equal(view.canDownload, false);
});

test("both roles read one project and only the project manager prompts", async () => {
  const store = memory();
  const sent = await call(store, "user_pm", {
    method: "POST",
    createId: "m1",
    json: { command: "prompt", body: "Page name is North Pier Fish." },
    complete: async () => "North Pier Fish sells fish on the pier.",
  });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.snapshot.messages.length, 2);
  assert.equal(sent.body.snapshot.messages[1].content.includes("pier"), true);
  const developer = await call(store, "user_dev", { method: "GET" });
  assert.equal(developer.body.canSend, false);
  assert.deepEqual(developer.body.messages, sent.body.snapshot.messages);
  const rejected = await call(store, "user_dev", {
    method: "POST",
    json: { command: "prompt", body: "I should not send this." },
  });
  assert.equal(rejected.status, 403);
  assert.equal(store.messages.length, 2);
});

test("a failed reply is still stored for the other browser", async () => {
  const store = memory();
  const sent = await call(store, "user_pm", {
    method: "POST",
    createId: "m2",
    json: { command: "prompt", body: "A fish shop." },
    complete: async () => {
      throw new Error("openrouter down");
    },
  });
  assert.equal(sent.status, 200);
  assert.equal(
    sent.body.snapshot.messages[1].content,
    "The reply could not be started.",
  );
  assert.equal(store.project.busy, false);
});

test("a second prompt waits while the first run holds the project", async () => {
  const store = memory();
  let release;
  const hold = new Promise((resolve) => {
    release = resolve;
  });
  const first = call(store, "user_pm", {
    method: "POST",
    createId: "m3",
    json: { command: "prompt", body: "First prompt." },
    complete: async () => {
      await hold;
      return "Summary.";
    },
  });
  let second;
  for (let attempt = 0; attempt < 20 && !store.project.busy; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  second = await call(store, "user_pm", {
    method: "POST",
    json: { command: "prompt", body: "Second prompt." },
    complete: async () => "No.",
  });
  assert.equal(second.status, 409);
  release();
  const done = await first;
  assert.equal(done.status, 200);
  assert.equal(store.messages.filter((row) => row.role === "user").length, 1);
});

test("implementation belongs to the developer and delivery to the project manager", async () => {
  const store = memory();
  await call(store, "user_pm", {
    method: "POST",
    createId: "m4",
    json: { command: "prompt", body: "North Pier <Fish>." },
    complete: async () => "A fish shop.",
  });
  const blocked = await call(store, "user_dev", {
    method: "POST",
    json: { command: "transition" },
  });
  assert.equal(blocked.status, 403);
  const moved = await call(store, "user_pm", {
    method: "POST",
    json: { command: "transition" },
  });
  assert.equal(moved.body.snapshot.phase, "implementation");
  assert.equal(moved.body.snapshot.questions.length, 1);
  assert.equal(moved.body.snapshot.questions[0].body, null);
  assert.equal(moved.body.snapshot.questions[0].canAnswer, false);
  const again = await call(store, "user_pm", {
    method: "POST",
    json: { command: "transition" },
  });
  assert.equal(again.status, 403);
  const developer = await call(store, "user_dev", { method: "GET" });
  assert.equal(
    developer.body.questions[0].body,
    "Approve the Implementation review.",
  );
  assert.equal(developer.body.canTransition, true);
  assert.equal(developer.body.transitionLabel, "Move to Delivery");
  const answer = await call(store, "user_dev", {
    method: "POST",
    createId: "a1",
    json: {
      command: "answer",
      questionId: developer.body.questions[0].id,
      body: "The menu is on the page.",
    },
  });
  assert.equal(answer.body.resolved, false);
  assert.equal(answer.body.view.status, "answered");
  assert.equal(store.answers.length, 1);
  const repeat = await call(store, "user_dev", {
    method: "POST",
    createId: "a2",
    json: {
      command: "answer",
      questionId: developer.body.questions[0].id,
      body: "Second answer.",
    },
  });
  assert.equal(repeat.status, 200);
  assert.equal(store.answers.length, 1);
  assert.equal(
    store.messages.filter((row) => row.role === "developer").length,
    1,
  );
  const manager = await call(store, "user_pm", { method: "GET" });
  assert.equal(manager.body.questions[0].status, "answered");
  assert.equal(manager.body.questions[0].body, null);
  assert.equal(
    manager.body.messages.some(
      (row) => row.content === "The menu is on the page.",
    ),
    true,
  );
  const pmDelivery = await call(store, "user_pm", {
    method: "POST",
    json: { command: "transition" },
  });
  assert.equal(pmDelivery.status, 403);
  const delivery = await call(store, "user_dev", {
    method: "POST",
    json: { command: "transition" },
  });
  assert.equal(delivery.body.snapshot.phase, "delivery");
  assert.equal(delivery.body.snapshot.canTransition, false);
  const devApprove = await call(store, "user_dev", {
    method: "POST",
    json: { command: "transition" },
  });
  assert.equal(devApprove.status, 403);
  const hidden = await call(store, "user_pm", {
    document: true,
    method: "GET",
  });
  assert.equal(hidden.status, 404);
  const approved = await call(store, "user_pm", {
    method: "POST",
    json: { command: "transition" },
  });
  assert.equal(approved.body.snapshot.phase, "delivered");
  assert.equal(approved.body.snapshot.canDownload, true);
  const pmFile = await call(store, "user_pm", {
    document: true,
    method: "GET",
  });
  const devFile = await call(store, "user_dev", {
    document: true,
    method: "GET",
  });
  assert.equal(pmFile.body, devFile.body);
  assert.match(pmFile.body, /<h1>Delivered<\/h1>/);
  assert.match(pmFile.body, /North Pier &lt;Fish&gt;/);
  assert.equal(pmFile.html, true);
  const duplicate = await call(store, "user_pm", {
    method: "POST",
    json: { command: "transition" },
  });
  assert.equal(duplicate.status, 403);
});

test("a removed membership and a signed-out request are denied", async () => {
  const store = memory();
  const removed = await handleProject({
    method: "GET",
    authorization: "Bearer session",
    env,
    query: store.query,
    verifySession: async () => ({ userId: "user_pm" }),
    clerkOrgIds: async () => [],
  });
  assert.equal(removed.status, 404);
  const signedOut = await handleProject({
    method: "GET",
    env,
    query: store.query,
  });
  assert.equal(signedOut.status, 401);
  const document = deliveryDocument([{ role: "user", content: "A & B" }]);
  assert.match(document, /A &amp; B/);
});

test("the walkthrough page polls the shared project", () => {
  const root = mkdtempSync(join(tmpdir(), "bolt-workflow-"));
  const bar = join(root, "app/components/factory");
  mkdirSync(bar, { recursive: true });
  writeFileSync(
    join(bar, "FactoryPhaseBar.tsx"),
    [
      "import type { FactoryPhaseComment } from '~/lib/factoryRun';",
      "              disabled={!unlocked}",
      "        {showApproval && (",
      "        {showApproval && !canApprove && (",
      '      <p className="mt-2 text-xs text-bolt-elements-textSecondary">',
      "        {factoryPhaseHint(phase)}",
    ].join("\n"),
  );
  mkdirSync(join(root, "app/components/chat"), { recursive: true });
  writeFileSync(
    join(root, "app/components/chat/ChatBox.tsx"),
    [
      "        <textarea",
      "          ref={props.textareaRef}",
      "          onKeyDown={(event) => {",
      "            if (event.key === 'Enter') {",
      "            props.walkthrough",
      "              ? 'Describe the page'",
    ].join("\n"),
  );
  applyBoltHitlPatches(root);
  const lines = applyBoltWorkflowPatches(root);
  assert.match(lines.join("\n"), /shared_project_module=written/);
  const barSource = readFileSync(join(bar, "FactoryPhaseBar.tsx"), "utf8");
  assert.match(barSource, /<SharedProject \/>/);
  assert.equal(barSource.includes("disabled={!unlocked}"), false);
  assert.match(barSource, /false && showApproval && \(/);
  const chat = readFileSync(
    join(root, "app/components/chat/ChatBox.tsx"),
    "utf8",
  );
  assert.match(chat, /readOnly=\{Boolean\(props\.walkthrough\)\}/);
  assert.match(chat, /Use the shared project prompt above/);
  assert.match(chat, /if \(props\.walkthrough\)/);
  const server = workflowServerSource();
  assert.match(server, /anthropic\/claude-sonnet-5\.5/);
  assert.match(server, /resolved: false/);
  assert.equal(server.includes("DurableObject"), false);
  assert.match(
    server,
    new RegExp(WORKFLOW_SQL.casPhase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  const page = readFileSync(
    join(root, "app/components/factory/SharedProject.tsx"),
    "utf8",
  );
  assert.match(page, /setInterval\(load, 2000\)/);
  assert.match(page, /factory-document\.html/);
  const replaced = readFileSync(join(bar, "FactoryPhaseBar.tsx"), "utf8");
  assert.equal(replaced.includes("HitlGateList"), false);
  assert.equal(replaced.match(/<SharedProject \/>/g)?.length, 1);
});

test("the deploy publishes this branch", () => {
  const workflow = readFileSync(
    new URL(
      "../../.github/workflows/bolt-preview-from-doppler.yml",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(workflow, /cursor\/shared-hitl-workflow-851d/);
  assert.match(workflow, /bolt-workflow\.mjs/);
});
