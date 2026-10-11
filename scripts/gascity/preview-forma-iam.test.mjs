import assert from "node:assert/strict";
import test from "node:test";
import {
  applyFargatePolicy,
  callerFromArn,
  fargatePolicy,
  grantPreviewFormaAccess,
  managedPolicyArn,
  redact,
} from "./preview-forma-iam.mjs";

test("the Fargate policy stays in Singapore and on preview-forma roles", () => {
  const policy = fargatePolicy("123456789012");
  const compute = policy.Statement[0];
  const roles = policy.Statement[1];
  assert.equal(
    compute.Condition.StringEquals["aws:RequestedRegion"],
    "ap-southeast-1",
  );
  assert.equal(
    roles.Resource,
    "arn:aws:iam::123456789012:role/preview-forma-*",
  );
  assert.equal(JSON.stringify(policy).includes("iam:CreateUser"), false);
  assert.equal(JSON.stringify(policy).includes("proud-salad"), false);
  assert.throws(() => fargatePolicy("123"), /12 digits/);
});

test("caller parsing and redaction hide the key material", () => {
  assert.deepEqual(callerFromArn("arn:aws:iam::123456789012:user/preview"), {
    accountId: "123456789012",
    kind: "user",
    name: "preview",
  });
  assert.equal(
    callerFromArn(
      "arn:aws:sts::123456789012:assumed-role/preview-admin/session",
    ).kind,
    "role",
  );
  const leaked = redact(
    'key AKIAIOSFODNN7EXAMPLE ASIAIOSFODNN7EXAMPLE {"SecretAccessKey":"secret-value"}',
  );
  assert.equal(leaked.includes("AKIAIOSFODNN7EXAMPLE"), false);
  assert.equal(leaked.includes("ASIAIOSFODNN7EXAMPLE"), false);
  assert.equal(leaked.includes("secret-value"), false);
});

test("attach uses a customer managed policy, not an inline user policy", () => {
  const calls = [];
  const run = (args) => {
    calls.push(args);
    return "{}";
  };
  const caller = { accountId: "123456789012", kind: "user", name: "anak" };
  const arn = applyFargatePolicy(caller, run);
  assert.equal(arn, managedPolicyArn(caller.accountId));
  assert.equal(
    calls.some((args) => args.includes("put-user-policy")),
    false,
  );
  assert.deepEqual(calls[0].slice(0, 4), [
    "iam",
    "create-policy",
    "--policy-name",
    "preview-forma-fargate",
  ]);
  assert.equal(calls[0].at(-1).includes("iam:CreateUser"), false);
  assert.equal(calls[1][1], "attach-user-policy");
  assert.equal(calls[1].at(-1), arn);
});

test("an existing managed policy gets a new default version", () => {
  const calls = [];
  const run = (args) => {
    calls.push(args);
    if (args[1] === "create-policy") {
      throw new Error("aws iam 254 EntityAlreadyExists");
    }
    return "{}";
  };
  applyFargatePolicy(
    { accountId: "123456789012", kind: "role", name: "preview-admin" },
    run,
  );
  assert.equal(calls[1][1], "create-policy-version");
  assert.equal(calls[1].includes("--set-as-default"), true);
  assert.equal(calls[2][1], "attach-role-policy");
});

test("access denied is not treated as an existing policy", () => {
  assert.throws(
    () =>
      applyFargatePolicy(
        { accountId: "123456789012", kind: "user", name: "anak" },
        () => {
          throw new Error("aws iam 254 AccessDenied");
        },
      ),
    /AccessDenied/,
  );
});

test("a full user policy quota attaches the managed policy to a deploy role", async () => {
  const calls = [];
  const run = (args) => {
    calls.push(args);
    if (args[1] === "attach-user-policy") {
      throw new Error("aws iam 254 LimitExceeded PoliciesPerUser: 10");
    }
    if (args[1] === "assume-role") {
      return "arn:aws:sts::123456789012:assumed-role/preview-forma-deploy/preview-forma\n";
    }
    return "{}";
  };
  const result = await grantPreviewFormaAccess(
    { accountId: "123456789012", kind: "user", name: "anak" },
    run,
    {},
    async () => {},
  );
  assert.equal(
    result.roleArn,
    "arn:aws:iam::123456789012:role/preview-forma-deploy",
  );
  assert.equal(
    result.assumed,
    "arn:aws:sts::123456789012:assumed-role/preview-forma-deploy/preview-forma",
  );
  const assume = calls.find((args) => args[1] === "assume-role");
  assert.equal(assume.includes("AssumedRoleUser.Arn"), true);
  assert.equal(assume.includes("--output"), true);
  assert.equal(
    calls.some((args) => args[1] === "attach-role-policy"),
    true,
  );
  assert.equal(JSON.stringify(result).includes("AKIA"), false);
  assert.equal(JSON.stringify(result).includes("ASIA"), false);
});

test("access denied does not fall back to creating a role", async () => {
  const calls = [];
  await assert.rejects(
    () =>
      grantPreviewFormaAccess(
        { accountId: "123456789012", kind: "user", name: "anak" },
        (args) => {
          calls.push(args[1]);
          throw new Error("aws iam 254 AccessDenied");
        },
      ),
    /AccessDenied/,
  );
  assert.equal(calls.includes("create-role"), false);
});
