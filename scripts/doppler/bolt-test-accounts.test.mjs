import assert from "node:assert/strict";
import test from "node:test";
import {
  TEST_ACCOUNTS,
  emailParameterRejected,
  findWewebplus,
  frontendApiHost,
  isClerkTestEmail,
  outputLines,
  planTestAccounts,
  signInCapabilities,
  testMembershipStatements,
} from "./bolt-test-accounts.mjs";
import { DEVELOPER_EMAIL, PROJECT_MANAGER_EMAIL } from "./bolt-sign-in.mjs";

const organization = {
  id: "org_3JuOz4PCITqmueMeKYhcFUXAEIH",
  name: "Wewebplus",
};

const humans = [
  {
    id: "user_pm",
    emails: [PROJECT_MANAGER_EMAIL],
    providers: ["oauth_google"],
    orgIds: [organization.id],
  },
  {
    id: "user_dev",
    emails: [DEVELOPER_EMAIL],
    providers: ["oauth_microsoft"],
    orgIds: [organization.id],
  },
];

// Shape of GET https://<frontend-api>/v1/environment on the walkthrough's
// Development instance: social sign-in only, ticket enabled, password off.
const environment = {
  display_config: { instance_environment_type: "development" },
  auth_config: {
    test_mode: true,
    first_factors: [
      "google_one_tap",
      "oauth_google",
      "oauth_microsoft",
      "ticket",
    ],
  },
  user_settings: {
    attributes: {
      email_address: { enabled: false },
      password: { enabled: false },
      ticket: { enabled: true },
    },
    sign_in: { second_factor: { required: false } },
    sign_up: { captcha_enabled: true },
  },
};

test("test addresses are Clerk test addresses and not the two people", () => {
  for (const account of TEST_ACCOUNTS) {
    assert.ok(isClerkTestEmail(account.email));
    assert.notEqual(account.email, PROJECT_MANAGER_EMAIL);
    assert.notEqual(account.email, DEVELOPER_EMAIL);
  }
  assert.equal(isClerkTestEmail(PROJECT_MANAGER_EMAIL), false);
  assert.deepEqual(
    TEST_ACCOUNTS.map((account) => account.roleId),
    ["project-manager", "developer"],
  );
});

test("the frontend api host comes from a development key only", () => {
  const encoded = Buffer.from("hardy-moth-75.clerk.accounts.dev$").toString(
    "base64",
  );
  assert.equal(
    frontendApiHost(`pk_test_${encoded}`),
    "hardy-moth-75.clerk.accounts.dev",
  );
  assert.equal(frontendApiHost(`pk_live_${encoded}`), null);
  assert.equal(frontendApiHost(""), null);
});

test("capabilities say ticket works and password does not", () => {
  const capabilities = signInCapabilities(environment);
  assert.equal(capabilities.instance, "development");
  assert.equal(capabilities.testMode, true);
  assert.equal(capabilities.ticket, true);
  assert.equal(capabilities.password, false);
  assert.equal(capabilities.emailCode, false);
  assert.equal(capabilities.secondFactorRequired, false);
  assert.deepEqual(capabilities.oauth, ["oauth_google", "oauth_microsoft"]);
});

test("password counts only when the attribute and the first factor agree", () => {
  const enabled = structuredClone(environment);
  enabled.user_settings.attributes.password.enabled = true;
  assert.equal(signInCapabilities(enabled).password, false);
  enabled.auth_config.first_factors.push("password");
  assert.equal(signInCapabilities(enabled).password, true);
});

test("a fresh instance creates both users and joins both", () => {
  const plan = planTestAccounts({
    accounts: humans,
    organization,
    memberCount: 2,
    maxMemberships: 5,
  });
  assert.equal(plan.length, 2);
  assert.ok(plan.every((account) => account.create && account.joinOrg));
  assert.ok(plan.every((account) => account.userId === null));
});

test("a second run creates nothing and joins only the missing member", () => {
  const plan = planTestAccounts({
    accounts: [
      ...humans,
      {
        id: "user_test_pm",
        emails: [TEST_ACCOUNTS[0].email],
        providers: [],
        orgIds: [organization.id],
      },
      {
        id: "user_test_dev",
        externalId: TEST_ACCOUNTS[1].externalId,
        emails: [],
        providers: [],
        orgIds: [],
      },
    ],
    organization,
    memberCount: 3,
    maxMemberships: 5,
  });
  assert.deepEqual(
    plan.map((account) => [
      account.userId,
      account.identifier,
      account.create,
      account.joinOrg,
    ]),
    [
      ["user_test_pm", "email", false, false],
      ["user_test_dev", "none", false, true],
    ],
  );
});

test("the membership limit is respected", () => {
  assert.throws(
    () =>
      planTestAccounts({
        accounts: humans,
        organization,
        memberCount: 4,
        maxMemberships: 5,
      }),
    /4 of 5 memberships/,
  );
  assert.throws(
    () =>
      planTestAccounts({
        accounts: humans,
        organization: null,
        memberCount: 0,
        maxMemberships: 5,
      }),
    /Wewebplus organization was not found/,
  );
});

test("only one Wewebplus organization is accepted", () => {
  assert.deepEqual(
    findWewebplus([organization, { id: "org_x", name: "Other" }]),
    organization,
  );
  assert.equal(
    findWewebplus([organization, { id: "org_y", name: "wewebplus" }]),
    null,
  );
  assert.equal(findWewebplus([]), null);
});

test("database rows carry the gate role for each test user", () => {
  const statements = testMembershipStatements({
    organizationId: organization.id,
    accounts: [
      { ...TEST_ACCOUNTS[0], userId: "user_test_pm" },
      { ...TEST_ACCOUNTS[1], userId: "user_test_dev" },
    ],
  });
  assert.deepEqual(
    statements.map((statement) => statement.params),
    [
      ["user_test_pm", organization.id, "project-manager"],
      ["user_test_dev", organization.id, "developer"],
    ],
  );
  assert.ok(
    statements.every((statement) =>
      /on conflict \(user_id, org_id\) do update/.test(statement.query),
    ),
  );
});

test("output lines name ids and factors, nothing secret", () => {
  const lines = outputLines(
    [
      { ...TEST_ACCOUNTS[0], userId: "user_test_pm", identifier: "email" },
      { ...TEST_ACCOUNTS[1], userId: "user_test_dev", identifier: "none" },
    ],
    signInCapabilities(environment),
  );
  assert.deepEqual(lines, [
    "pm_email=walkthrough-pm+clerk_test@example.com",
    "pm_user_id=user_test_pm",
    "pm_identifier=email",
    "dev_email=walkthrough-dev+clerk_test@example.com",
    "dev_user_id=user_test_dev",
    "dev_identifier=none",
    "ticket_first_factor=on",
    "password_first_factor=off",
    "email_code_first_factor=off",
    "second_factor_required=no",
  ]);
});

test("only the email-attribute rejection triggers the identifier-less retry", () => {
  assert.equal(
    emailParameterRejected(
      'Clerk POST /v1/users failed: 422 {"errors":[{"message":"is unknown","long_message":"email_address is not a valid parameter for this request. Please ensure the appropriate settings are enabled."}]}',
    ),
    true,
  );
  assert.equal(
    emailParameterRejected("Clerk POST /v1/users failed: 429"),
    false,
  );
  assert.equal(emailParameterRejected(undefined), false);
});
