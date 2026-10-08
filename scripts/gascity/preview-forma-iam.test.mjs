import assert from "node:assert/strict";
import test from "node:test";
import { callerFromArn, fargatePolicy, redact } from "./preview-forma-iam.mjs";

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
  assert.equal(
    redact("key AKIAIOSFODNN7EXAMPLE leaked").includes("AKIAIOSFODNN7EXAMPLE"),
    false,
  );
});
