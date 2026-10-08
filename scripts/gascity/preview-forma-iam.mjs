#!/usr/bin/env node
// Attach the preview-forma Fargate policy to the Doppler aws/dev caller.
// Prints the caller ARN and the policy name. Does not print credentials.

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const region = "ap-southeast-1";

export function redact(text) {
  return String(text ?? "")
    .replace(/AKIA[0-9A-Z]{16}/g, "AKIA_REDACTED")
    .replace(
      /aws_secret_access_key[=:]\s*\S+/gi,
      "aws_secret_access_key=redacted",
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
  const arn = applyFargatePolicy(caller, run, env);
  console.log(`preview_forma_iam_policy=attached ${arn}`);
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
