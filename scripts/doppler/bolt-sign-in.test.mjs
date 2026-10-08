import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  SQL,
  applyBoltHitlPatches,
  clerkPublishable,
  handleHitl,
  handleSession,
  patchBoltHeader,
} from "./bolt-hitl.mjs";
import {
  clerkKeyKind,
  matchGateAccounts,
  membershipSeedStatements,
  originsWithWalkthrough,
  sharedOrganization,
  WALKTHROUGH_ORIGIN,
} from "./bolt-sign-in.mjs";

const org = {
  id: "org_3JuOz4PCITqmueMeKYhcFUXAEIH",
  name: "Wewebplus",
};

test("a removed Clerk membership hides the role row", async () => {
  const questions = [
    {
      id: "q1",
      org_id: org.id,
      app_id: "maple",
      phase: "discovery",
      run_id: "run-1",
      step_id: "plan-approve",
      target_role_id: "project-manager",
      visibility: "role",
      status: "open",
      body: "Approve the Discovery plan.",
      idempotency_key: "run-1:plan-approve",
      answered_by_name: null,
    },
  ];
  const memberships = [
    {
      user_id: "user_pm",
      org_id: org.id,
      role_id: "project-manager",
    },
  ];
  const query = async (sql, params) => {
    if (sql === SQL.memberships || sql === SQL.membership) {
      return memberships.filter((row) => row.user_id === params[0]);
    }
    if (sql === SQL.listQuestions) return questions;
    if (sql === SQL.questionById) return questions;
    throw new Error(sql);
  };
  const env = {
    WEWEBPLUS_DATABASE_URL:
      "postgres://user:secret@ep.example.neon.tech/neondb",
    GAS_CITY_HOST_BRIDGE_TOKEN: "machine-token",
  };
  const listed = await handleHitl({
    method: "GET",
    phase: "discovery",
    authorization: "Bearer session",
    env,
    query,
    verifySession: async () => ({ userId: "user_pm" }),
    clerkOrgIds: async () => [],
  });
  assert.deepEqual(listed.body.questions, []);
  const answer = await handleHitl({
    method: "POST",
    questionId: "q1",
    answering: true,
    authorization: "Bearer session",
    json: { body: "approve" },
    env,
    query,
    verifySession: async () => ({ userId: "user_pm" }),
    clerkOrgIds: async () => [],
  });
  assert.equal(answer.status, 404);
});

test("one Wewebplus membership names the role and a live key is refused", async () => {
  const env = {
    WEWEBPLUS_DATABASE_URL:
      "postgres://user:secret@ep.example.neon.tech/neondb",
    CLERK_PUBLISHABLE_KEY: "pk_test_example",
  };
  assert.equal(clerkPublishable(env).body.publishableKey, "pk_test_example");
  assert.equal(
    clerkPublishable({ CLERK_PUBLISHABLE_KEY: "pk_live_example" }).status,
    404,
  );
  const session = await handleSession({
    authorization: "Bearer session",
    env,
    verifySession: async () => ({ userId: "user_pm" }),
    clerkOrgIds: async () => [org.id],
    orgNames: async () => ({ [org.id]: "Wewebplus" }),
    query: async () => [
      { user_id: "user_pm", org_id: org.id, role_id: "project-manager" },
    ],
  });
  assert.equal(session.body.organization, "Wewebplus");
  assert.equal(session.body.role, "Project Manager");
  const many = await handleSession({
    authorization: "Bearer session",
    env,
    verifySession: async () => ({ userId: "user_pm" }),
    clerkOrgIds: async () => [org.id, "org_other"],
    query: async () => [
      { user_id: "user_pm", org_id: org.id, role_id: "project-manager" },
      { user_id: "user_pm", org_id: "org_other", role_id: "developer" },
    ],
  });
  assert.equal(many.body.role, null);
  const signedOut = await handleSession({ env });
  assert.equal(signedOut.body.signedIn, false);
});

test("the header shows sign in before a chat starts", () => {
  const source = [
    "import { classNames } from '~/utils/classNames';",
    "export function Header() {",
    "      )}",
    "    </header>",
  ].join("\n");
  const patched = patchBoltHeader(source);
  assert.match(patched, /BoltSignIn/);
  assert.equal(patchBoltHeader(patched), patched);
  const root = mkdtempSync(join(tmpdir(), "bolt-sign-in-"));
  const bar = join(root, "app/components/factory");
  mkdirSync(bar, { recursive: true });
  writeFileSync(
    join(bar, "FactoryPhaseBar.tsx"),
    [
      "import type { FactoryPhaseComment } from '~/lib/factoryRun';",
      '      <p className="mt-2 text-xs text-bolt-elements-textSecondary">',
      "        {factoryPhaseHint(phase)}",
    ].join("\n"),
  );
  mkdirSync(join(root, "app/components/header"), { recursive: true });
  writeFileSync(join(root, "app/components/header/Header.tsx"), source);
  const lines = applyBoltHitlPatches(root);
  assert.match(lines.join("\n"), /sign_in_patch=applied/);
  const server = readFileSync(join(root, "app/lib/hitl/server.ts"), "utf8");
  assert.match(server, /organization_memberships/);
  assert.equal(server.includes("pk_(test|live)_"), false);
  assert.match(server, /resolved: false/);
  const list = readFileSync(
    join(root, "app/components/factory/HitlGateList.tsx"),
    "utf8",
  );
  assert.match(list, /hitlFetch/);
  const client = readFileSync(join(root, "app/lib/hitl/client.ts"), "utf8");
  assert.match(client, /Authorization/);
  const signIn = readFileSync(
    join(root, "app/components/header/BoltSignIn.tsx"),
    "utf8",
  );
  assert.match(signIn, /Sign in/);
  assert.match(signIn, /redirectToSignIn/);
});

test("development accounts land on Wewebplus roles", () => {
  assert.equal(clerkKeyKind("pk_test_abc"), "test");
  assert.equal(clerkKeyKind("sk_live_abc"), "live");
  const matched = matchGateAccounts([
    {
      id: "user_pm",
      emails: ["anakwannaphaschaiyong@gmail.com"],
      providers: ["oauth_google"],
      orgIds: [org.id],
    },
    {
      id: "user_live_dev",
      emails: [],
      providers: ["oauth_microsoft"],
      orgIds: [org.id],
    },
  ]);
  assert.equal(matched.projectManager.id, "user_pm");
  assert.equal(matched.developer.id, "user_live_dev");
  assert.equal(
    sharedOrganization(matched.projectManager, matched.developer, [org]).id,
    org.id,
  );
  assert.equal(
    sharedOrganization(matched.projectManager, matched.developer, [
      { id: org.id, name: "Other" },
    ]),
    null,
  );
  const ambiguous = matchGateAccounts([
    {
      id: "user_pm",
      emails: ["anakwannaphaschaiyong@gmail.com"],
      providers: ["oauth_google"],
      orgIds: [org.id],
    },
    {
      id: "user_a",
      emails: [],
      providers: ["oauth_microsoft"],
      orgIds: [org.id],
    },
    {
      id: "user_b",
      emails: [],
      providers: ["oauth_microsoft"],
      orgIds: [org.id],
    },
  ]);
  assert.equal(ambiguous.developer, null);
  const byEmail = matchGateAccounts([
    {
      id: "user_pm",
      emails: ["anakwannaphaschaiyong@gmail.com"],
      providers: ["oauth_google"],
      orgIds: [org.id],
    },
    {
      id: "user_fau",
      emails: ["awannaphasch2016@fau.edu"],
      providers: ["oauth_microsoft"],
      orgIds: [org.id],
    },
    {
      id: "user_other",
      emails: [],
      providers: ["oauth_microsoft"],
      orgIds: [org.id],
    },
  ]);
  assert.equal(byEmail.developer.id, "user_fau");
});

test("the preview seed does not reset an answered question", () => {
  const statements = membershipSeedStatements({
    organizationId: org.id,
    projectManagerId: "user_pm",
    developerId: "user_live_dev",
  });
  const sql = statements.map((item) => item.query).join("\n");
  assert.match(sql, /on conflict \(org_id, idempotency_key\) do nothing/);
  assert.equal(sql.includes("user_3K58"), false);
  const roles = statements.filter((item) =>
    item.query.includes("into wewebplus.memberships"),
  );
  assert.deepEqual(
    roles.map((item) => item.params[0]),
    ["user_pm", "user_live_dev"],
  );
  const first = originsWithWalkthrough(["https://app.example"]);
  assert.equal(first.added, true);
  assert.equal(first.origins[0], "https://app.example");
  assert.equal(first.origins[1], WALKTHROUGH_ORIGIN);
  assert.equal(originsWithWalkthrough(first.origins).added, false);
  const workflow = readFileSync(
    new URL(
      "../../.github/workflows/bolt-preview-from-doppler.yml",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(workflow, /bolt-sign-in\.mjs/);
});
