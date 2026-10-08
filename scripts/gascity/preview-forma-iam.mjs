#!/usr/bin/env node
// Attach the preview-forma Fargate policy to the Doppler aws/dev caller.
// Prints the caller ARN and the policy name. Does not print credentials.
// Run 37840598579 created policy preview-forma-fargate and role
// preview-forma-deploy, then assumed that role. The push-triggered
// workflow was removed after that run. Do not add this script back as a
// standing secret job.

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const region = "ap-southeast-1";

export function redact(text) {
  return String(text ?? "")
    .replace(/AKIA[0-9A-Z]{16}/g, "AKIA_REDACTED")
    .replace(/ASIA[0-9A-Z]{16}/g, "ASIA_REDACTED")
    .replace(
      /aws_secret_access_key[=:]\s*\S+/gi,
      "aws_secret_access_key=redacted",
    )
    .replace(
      /"(SecretAccessKey|SessionToken|AccessKeyId)"\s*:\s*"[^"]*"/g,
      '"$1":"redacted"',
    )
    .replace(/dp\.st\.[A-Za-z0-9]+/g, "dp.st.redacted");
}

export function fargatePolicy(accountId) {
  if (!/^[0-9]{12}$/.test(accountId)) {
    throw new Error("AWS account id must be 12 digits");
  }
  const roleArn = `arn:aws:iam::${accountId}:role/preview-forma-*`;
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "PreviewFormaCompute",
        Effect: "Allow",
        Action: [
          "ecs:CreateCluster",
          "ecs:DeleteCluster",
          "ecs:DescribeClusters",
          "ecs:ListClusters",
          "ecs:RegisterTaskDefinition",
          "ecs:DeregisterTaskDefinition",
          "ecs:DescribeTaskDefinition",
          "ecs:ListTaskDefinitions",
          "ecs:CreateService",
          "ecs:UpdateService",
          "ecs:DeleteService",
          "ecs:DescribeServices",
          "ecs:ListServices",
          "ecs:RunTask",
          "ecs:StopTask",
          "ecs:DescribeTasks",
          "ecs:ListTasks",
          "ecs:TagResource",
          "ec2:DescribeVpcs",
          "ec2:DescribeSubnets",
          "ec2:DescribeSecurityGroups",
          "ec2:DescribeNetworkInterfaces",
          "ec2:CreateSecurityGroup",
          "ec2:DeleteSecurityGroup",
          "ec2:AuthorizeSecurityGroupIngress",
          "ec2:AuthorizeSecurityGroupEgress",
          "ec2:RevokeSecurityGroupIngress",
          "ec2:CreateTags",
          "elasticloadbalancing:CreateLoadBalancer",
          "elasticloadbalancing:DeleteLoadBalancer",
          "elasticloadbalancing:DescribeLoadBalancers",
          "elasticloadbalancing:CreateTargetGroup",
          "elasticloadbalancing:DeleteTargetGroup",
          "elasticloadbalancing:DescribeTargetGroups",
          "elasticloadbalancing:ModifyTargetGroupAttributes",
          "elasticloadbalancing:CreateListener",
          "elasticloadbalancing:DeleteListener",
          "elasticloadbalancing:DescribeListeners",
          "elasticloadbalancing:CreateRule",
          "elasticloadbalancing:DeleteRule",
          "elasticloadbalancing:DescribeRules",
          "elasticloadbalancing:ModifyRule",
          "elasticloadbalancing:RegisterTargets",
          "elasticloadbalancing:DeregisterTargets",
          "elasticloadbalancing:DescribeTargetHealth",
          "logs:CreateLogGroup",
          "logs:DeleteLogGroup",
          "logs:DescribeLogGroups",
          "logs:PutRetentionPolicy",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogStreams",
        ],
        Resource: "*",
        Condition: { StringEquals: { "aws:RequestedRegion": region } },
      },
      {
        Sid: "PreviewFormaTaskRole",
        Effect: "Allow",
        Action: [
          "iam:CreateRole",
          "iam:GetRole",
          "iam:DeleteRole",
          "iam:TagRole",
          "iam:PassRole",
          "iam:AttachRolePolicy",
          "iam:DetachRolePolicy",
          "iam:ListAttachedRolePolicies",
        ],
        Resource: roleArn,
      },
    ],
  };
}

function aws(args, env, input) {
  const result = spawnSync("aws", args, {
    encoding: "utf8",
    env,
    input,
  });
  const output = redact(`${result.stdout || ""}\n${result.stderr || ""}`);
  if (result.status !== 0) {
    throw new Error(`aws ${args[0]} ${result.status} ${output}`);
  }
  return result.stdout || "";
}

async function downloadAwsDev(token) {
  const response = await fetch(
    "https://api.doppler.com/v3/configs/config/secrets/download?project=aws&config=dev&format=json",
    {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    },
  );
  if (!response.ok) {
    throw new Error(`Doppler aws/dev download failed (${response.status})`);
  }
  return response.json();
}

export function managedPolicyArn(accountId) {
  return `arn:aws:iam::${accountId}:policy/preview-forma-fargate`;
}

export function applyFargatePolicy(caller, run, env = {}) {
  const document = JSON.stringify(fargatePolicy(caller.accountId));
  const arn = managedPolicyArn(caller.accountId);
  try {
    run(
      [
        "iam",
        "create-policy",
        "--policy-name",
        "preview-forma-fargate",
        "--policy-document",
        document,
      ],
      env,
    );
  } catch (error) {
    if (!String(error.message).includes("EntityAlreadyExists")) throw error;
    run(
      [
        "iam",
        "create-policy-version",
        "--policy-arn",
        arn,
        "--set-as-default",
        "--policy-document",
        document,
      ],
      env,
    );
  }
  if (caller.kind === "user") {
    run(
      [
        "iam",
        "attach-user-policy",
        "--user-name",
        caller.name,
        "--policy-arn",
        arn,
      ],
      env,
    );
  } else {
    run(
      [
        "iam",
        "attach-role-policy",
        "--role-name",
        caller.name,
        "--policy-arn",
        arn,
      ],
      env,
    );
  }
  return arn;
}

export function isPolicyCountQuota(error) {
  const message = String(error?.message ?? "");
  return (
    message.includes("LimitExceeded") && message.includes("PoliciesPerUser")
  );
}

export function deployRoleArn(accountId) {
  return `arn:aws:iam::${accountId}:role/preview-forma-deploy`;
}

export function listUserAccess(caller, run, env = {}) {
  const managed = JSON.parse(
    run(
      ["iam", "list-attached-user-policies", "--user-name", caller.name],
      env,
    ),
  );
  const inline = JSON.parse(
    run(["iam", "list-user-policies", "--user-name", caller.name], env),
  );
  return {
    managed: (managed.AttachedPolicies ?? []).map(
      (policy) => policy.PolicyName,
    ),
    inline: inline.PolicyNames ?? [],
  };
}

export function ensureDeployRole(caller, policyArn, run, env = {}) {
  const roleName = "preview-forma-deploy";
  const trust = JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: {
          AWS: `arn:aws:iam::${caller.accountId}:user/${caller.name}`,
        },
        Action: "sts:AssumeRole",
      },
    ],
  });
  try {
    run(
      [
        "iam",
        "create-role",
        "--role-name",
        roleName,
        "--assume-role-policy-document",
        trust,
        "--description",
        "preview-forma Fargate deploy",
      ],
      env,
    );
  } catch (error) {
    if (!String(error.message).includes("EntityAlreadyExists")) throw error;
  }
  run(
    [
      "iam",
      "update-assume-role-policy",
      "--role-name",
      roleName,
      "--policy-document",
      trust,
    ],
    env,
  );
  run(
    [
      "iam",
      "attach-role-policy",
      "--role-name",
      roleName,
      "--policy-arn",
      policyArn,
    ],
    env,
  );
  return deployRoleArn(caller.accountId);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function proveAssumeRole(roleArn, run, env = {}, pause = delay) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const assumed = String(
        run(
          [
            "sts",
            "assume-role",
            "--role-arn",
            roleArn,
            "--role-session-name",
            "preview-forma",
            "--duration-seconds",
            "900",
            "--query",
            "AssumedRoleUser.Arn",
            "--output",
            "text",
          ],
          env,
        ),
      ).trim();
      if (!assumed.startsWith("arn:aws:sts::")) {
        throw new Error("AssumeRole did not return an assumed-role ARN");
      }
      return assumed;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await pause(5000);
    }
  }
  throw lastError;
}

export async function grantPreviewFormaAccess(
  caller,
  run,
  env = {},
  pause = delay,
) {
  try {
    return { arn: applyFargatePolicy(caller, run, env) };
  } catch (error) {
    if (!isPolicyCountQuota(error) || caller.kind !== "user") throw error;
    const arn = managedPolicyArn(caller.accountId);
    const roleArn = ensureDeployRole(caller, arn, run, env);
    const assumed = await proveAssumeRole(roleArn, run, env, pause);
    return { arn, roleArn, assumed };
  }
}

export function callerFromArn(arn) {
  const user = /^arn:aws:iam::([0-9]{12}):user\/(.+)$/.exec(arn);
  if (user) return { accountId: user[1], kind: "user", name: user[2] };
  const role = /^arn:aws:sts::([0-9]{12}):assumed-role\/([^/]+)\//.exec(arn);
  if (role) return { accountId: role[1], kind: "role", name: role[2] };
  throw new Error("Caller ARN is not an IAM user or assumed role");
}

export async function attachPreviewFormaPolicy({ token, run = aws }) {
  const downloaded = await downloadAwsDev(token);
  const accessKey = String(downloaded.AWS_ACCESS_KEY_ID ?? "").trim();
  const secretKey = String(downloaded.AWS_SECRET_ACCESS_KEY ?? "").trim();
  if (!accessKey || !secretKey) {
    throw new Error("Doppler aws/dev is missing the AWS key pair");
  }
  const env = {
    ...process.env,
    AWS_ACCESS_KEY_ID: accessKey,
    AWS_SECRET_ACCESS_KEY: secretKey,
    AWS_DEFAULT_REGION: region,
    AWS_REGION: region,
  };
  const identity = JSON.parse(run(["sts", "get-caller-identity"], env));
  const caller = callerFromArn(identity.Arn);
  console.log(`preview_forma_iam_account=${caller.accountId}`);
  console.log(`preview_forma_iam_caller=${identity.Arn}`);
  if (caller.kind === "user") {
    try {
      const access = listUserAccess(caller, run, env);
      console.log(
        `preview_forma_iam_managed=${access.managed.join(",") || "none"}`,
      );
      console.log(
        `preview_forma_iam_inline=${access.inline.join(",") || "none"}`,
      );
    } catch (error) {
      console.log(
        `preview_forma_iam_policies=list_failed ${redact(error?.message)}`,
      );
    }
  }
  const granted = await grantPreviewFormaAccess(caller, run, env);
  console.log(`preview_forma_iam_policy=attached ${granted.arn}`);
  if (granted.roleArn) {
    console.log(`preview_forma_iam_role=${granted.roleArn}`);
  }
  return caller;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const token = process.env.DOPPLER_ADMIN_TOKEN ?? "";
  if (!token) {
    console.log("DOPPLER_ADMIN_TOKEN=absent");
    process.exit(1);
  }
  attachPreviewFormaPolicy({ token }).catch((error) => {
    console.log(redact(error?.message || String(error)));
    process.exit(1);
  });
}
