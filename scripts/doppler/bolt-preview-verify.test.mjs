import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  IMPLEMENTATION_QUESTION_BODY,
  transitionLabel,
  waitingLabel,
} from "./bolt-workflow.mjs";
import {
  FUNCTIONAL_STEPS,
  TOKEN_TTL_SECONDS,
  WALKTHROUGH_EXPECTATIONS,
  assertDevelopmentSecret,
  classifyPreview,
  createReport,
  finishReport,
  markStep,
  redactVerificationError,
  renderSummary,
  resetStatements,
  signInTokenBody,
} from "./bolt-preview-verify.mjs";

test("reset deletes trial rows and returns Discovery", () => {
  const statements = resetStatements(
    "bolt-walkthrough",
    "bolt-walkthrough-chat",
  );
  const sql = statements.map((item) => item.query).join("\n");
  assert.match(sql, /delete from wewebplus\.answers/);
  assert.match(sql, /delete from wewebplus\.questions/);
  assert.match(sql, /delete from wewebplus\.messages/);
  assert.match(sql, /phase = 'discovery'/);
  assert.equal(sql.includes("delete from wewebplus.memberships"), false);
  assert.equal(sql.includes("delete from wewebplus.apps"), false);
  assert.equal(sql.includes("delete from wewebplus.chats"), false);
  assert.equal(sql.includes("delete from wewebplus.roles"), false);
  assert.deepEqual(statements[0].params, ["bolt-walkthrough"]);
  assert.deepEqual(statements[2].params, ["bolt-walkthrough-chat"]);
  assert.ok(
    sql.indexOf("delete from wewebplus.answers") <
      sql.indexOf("delete from wewebplus.questions"),
  );
});

test("sign-in tokens are short-lived and name the organization", () => {
  assert.deepEqual(
    signInTokenBody({ userId: "user_pm", orgId: "org_wewebplus" }),
    {
      user_id: "user_pm",
      expires_in_seconds: TOKEN_TTL_SECONDS,
      org_id: "org_wewebplus",
    },
  );
  assert.throws(
    () =>
      signInTokenBody({
        userId: "user_pm",
        orgId: "org_wewebplus",
        expiresInSeconds: 60 * 60 * 24 * 30,
      }),
    /600/,
  );
  assert.throws(() => signInTokenBody({ userId: "", orgId: "org_wewebplus" }));
});

test("live Clerk keys stop the walkthrough", () => {
  assert.equal(assertDevelopmentSecret("sk_test_example"), "sk_test");
  assert.throws(
    () => assertDevelopmentSecret("sk_live_example"),
    /clerk_secret=live/,
  );
  assert.throws(
    () => assertDevelopmentSecret("pk_test_example"),
    /clerk_secret=not_test/,
  );
  assert.throws(() => assertDevelopmentSecret(""), /clerk_secret=not_test/);
});

test("errors do not keep tickets or keys", () => {
  const text = redactVerificationError(
    "sign-in failed sk_test_abcdefghijklmnopqrstuvwxyz eyJhbGciOiJIUzI1NiJ9",
  );
  assert.equal(text.includes("sk_test_abcdefghijklmnopqrstuvwxyz"), false);
  assert.equal(text.includes("eyJhbGciOiJIUzI1NiJ9"), false);
  assert.match(text, /clerk_redacted/);
  assert.match(text, /jwt_redacted/);
});

test("a failed step stays failed and later steps stay unverified", () => {
  const report = createReport();
  markStep(report, "reset-project", "passed");
  markStep(report, "sign-in-project-manager", "failed");
  finishReport(report, classifyPreview({}));
  assert.equal(report.functional, "failed");
  assert.equal(report.failedStep, "sign-in-project-manager");
  assert.equal(
    report.steps.find((step) => step.name === "downloads-match").status,
    "not_run",
  );
  assert.equal(
    report.unverified.find((item) => item.layer === "generated-website").status,
    "unverified",
  );
  assert.equal(
    report.unverified.find((item) => item.layer === "visual-regression").status,
    "not_run",
  );
  assert.equal(
    report.unverified.find((item) => item.layer === "agentic-ux").status,
    "not_run",
  );
  const summary = renderSummary(report);
  assert.match(summary, /functional=failed/);
  assert.match(summary, /resets_shared_project=bolt-walkthrough/);
  assert.equal(summary.includes("sk_test_"), false);
});

test("readable preview text is still not a pass", () => {
  const preview = classifyPreview({
    src: "https://preview.example",
    text: "Hello",
    readable: true,
  });
  assert.equal(preview.status, "unverified");
  const report = createReport();
  for (const name of FUNCTIONAL_STEPS) markStep(report, name, "passed");
  finishReport(report, preview);
  assert.equal(report.functional, "passed");
  assert.match(renderSummary(report), /generated-website=unverified/);
  assert.match(renderSummary(report), /agentic-ux=not_run/);
});

test("the contract matches the product labels and does not follow them by import", () => {
  assert.equal(
    WALKTHROUGH_EXPECTATIONS.moveToImplementation,
    transitionLabel("discovery"),
  );
  assert.equal(
    WALKTHROUGH_EXPECTATIONS.moveToDelivery,
    transitionLabel("implementation"),
  );
  assert.equal(
    WALKTHROUGH_EXPECTATIONS.approveDelivery,
    transitionLabel("delivery"),
  );
  assert.equal(
    WALKTHROUGH_EXPECTATIONS.waitingOnProjectManager,
    waitingLabel("discovery", "developer", []),
  );
  assert.equal(
    WALKTHROUGH_EXPECTATIONS.waitingOnDeveloper,
    waitingLabel("implementation", "project-manager", [
      {
        phase: "implementation",
        stepId: "review-approve-dev",
        targetRoleId: "developer",
        status: "open",
      },
    ]),
  );
  assert.equal(
    WALKTHROUGH_EXPECTATIONS.waitingOnProjectManager,
    waitingLabel("delivery", "developer", []),
  );
  assert.equal(
    WALKTHROUGH_EXPECTATIONS.implementationQuestion,
    IMPLEMENTATION_QUESTION_BODY,
  );
  assert.equal(WALKTHROUGH_EXPECTATIONS.answer, "The menu is on the page.");
  assert.equal(
    WALKTHROUGH_EXPECTATIONS.discoveryPrompt,
    "A one-page site for North Pier Fish with the restaurant name, a welcome line, and a menu of fish and chips, clam chowder, and iced tea.",
  );
  assert.equal(FUNCTIONAL_STEPS.includes("send-discovery-description"), true);
  assert.equal(
    WALKTHROUGH_EXPECTATIONS.projectManager,
    "Wewebplus · Project Manager",
  );
  assert.equal(WALKTHROUGH_EXPECTATIONS.developer, "Wewebplus · Developer");
  const source = readFileSync(
    new URL("./bolt-preview-verify.mjs", import.meta.url),
    "utf8",
  );
  assert.equal(source.includes("transitionLabel"), false);
  assert.equal(source.includes("waitingLabel"), false);
  assert.match(source, /strategy: "ticket"/);
  assert.match(source, /sign_in_tokens/);
  for (const pattern of [
    "accounts.google.com",
    "login.microsoftonline.com",
    "login.live.com",
    "authenticator",
    "browserbase",
    "stagehand",
    "skyvern",
    "momentic",
  ]) {
    assert.equal(source.toLowerCase().includes(pattern), false, pattern);
  }
});

test("the preview workflow runs this check after deploy", () => {
  const workflow = readFileSync(
    new URL(
      "../../.github/workflows/bolt-preview-from-doppler.yml",
      import.meta.url,
    ),
    "utf8",
  );
  assert.ok(workflow.split("cursor/preview-ui-verify-851d").length >= 4);
  assert.match(workflow, /bolt-preview-verify\.mjs/);
  assert.match(workflow, /needs: deploy/);
  assert.match(workflow, /playwright@1\.58\.2/);
  assert.match(workflow, /upload-artifact@v6/);
  assert.match(workflow, /set \+x/);
  assert.equal(workflow.includes("browserbase"), false);
  assert.equal(workflow.includes("stagehand"), false);
  assert.equal(
    workflow.toLowerCase().includes('echo "$clerk_secret_key"'),
    false,
  );
});
