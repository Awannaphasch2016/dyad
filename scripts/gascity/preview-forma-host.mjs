#!/usr/bin/env node
// Create the preview-forma Fargate host in ap-southeast-1.
// Assumes role preview-forma-deploy. Does not run a task or create a service.
// Does not print credentials.

import { spawnSync } from "node:child_process";
import { writeSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const region = "ap-southeast-1";
export const PREVIEW_FORMA_ACCOUNT = "755283537543";
export const FORMA_IMAGE =
  "ghcr.io/awannaphasch2016/forma:sha-80a8e419f6285378b4dfada336ea8213f3089bab";
const executionPolicy =
  "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy";

export function hostNames() {
  return {
    cluster: "preview-forma",
    logGroup: "/ecs/preview-forma",
    albSecurityGroup: "preview-forma-alb",
    taskSecurityGroup: "preview-forma-tasks",
    loadBalancer: "preview-forma",
    targetGroup: "preview-forma-http",
    executionRole: "preview-forma-execution",
    taskFamily: "preview-forma",
    containerName: "forma",
    containerPort: 3000,
  };
}

export function redact(text) {
  return String(text ?? "")
    .replace(/AKIA[0-9A-Z]{16}/g, "AKIA_REDACTED")
    .replace(/ASIA[0-9A-Z]{16}/g, "ASIA_REDACTED")
    .replace(
      /aws_secret_access_key[=:]\s*\S+/gi,
      "aws_secret_access_key=redacted",
    )
    .replace(
      /"(SecretAccessKey|SessionToken|AccessKeyId|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN)"\s*:\s*"[^"]*"/g,
      '"$1":"redacted"',
    )
    .replace(/dp\.st\.[A-Za-z0-9]+/g, "dp.st.redacted");
}

export function assertFormaImage(image) {
  if (image !== FORMA_IMAGE) {
    throw new Error("Refusing an image other than the pinned Forma tag");
  }
}

export function selectPublicSubnets(subnets) {
  const byAz = new Map();
  for (const subnet of subnets ?? []) {
    if (!subnet?.MapPublicIpOnLaunch || subnet.State !== "available") continue;
    if (!byAz.has(subnet.AvailabilityZone)) {
      byAz.set(subnet.AvailabilityZone, subnet);
    }
  }
  const chosen = [...byAz.values()].slice(0, 2);
  if (chosen.length < 2) {
    throw new Error("Need two public subnets in different availability zones");
  }
  return chosen;
}

export function ingressPresent(group, { port, cidr, sourceGroupId }) {
  return (group?.IpPermissions ?? []).some((permission) => {
    const protocol = permission.IpProtocol;
    const portMatches =
      protocol === "-1" || Number(permission.FromPort) === Number(port);
    if (!portMatches) return false;
    if (cidr) {
      return (permission.IpRanges ?? []).some((range) => range.CidrIp === cidr);
    }
    if (sourceGroupId) {
      return (permission.UserIdGroupPairs ?? []).some(
        (pair) => pair.GroupId === sourceGroupId,
      );
    }
    return false;
  });
}

export function executionRoleTrust() {
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { Service: "ecs-tasks.amazonaws.com" },
        Action: "sts:AssumeRole",
      },
    ],
  };
}

export function taskDefinitionDocument({ accountId, image }) {
  if (!/^[0-9]{12}$/.test(accountId)) {
    throw new Error("AWS account id must be 12 digits");
  }
  assertFormaImage(image);
  const names = hostNames();
  return {
    family: names.taskFamily,
    networkMode: "awsvpc",
    requiresCompatibilities: ["FARGATE"],
    cpu: "512",
    memory: "1024",
    executionRoleArn: `arn:aws:iam::${accountId}:role/${names.executionRole}`,
    containerDefinitions: [
      {
        name: names.containerName,
        image,
        essential: true,
        portMappings: [{ containerPort: names.containerPort, protocol: "tcp" }],
        logConfiguration: {
          logDriver: "awslogs",
          options: {
            "awslogs-group": names.logGroup,
            "awslogs-region": region,
            "awslogs-stream-prefix": names.containerName,
          },
        },
      },
    ],
  };
}

export function shouldUseUserForCluster(error) {
  return /service linked role|ServiceLinkedRole|AWSServiceRoleForECS/i.test(
    String(error?.message ?? ""),
  );
}

export function withServiceLinkedRole(document, accountId) {
  if (!/^[0-9]{12}$/.test(accountId)) {
    throw new Error("AWS account id must be 12 digits");
  }
  if (!Array.isArray(document?.Statement)) {
    throw new Error("Policy document has no statements");
  }
  if (
    document.Statement.some((item) => item.Sid === "PreviewFormaServiceRoles")
  ) {
    return document;
  }
  const doc = structuredClone(document);
  doc.Statement.push({
    Sid: "PreviewFormaServiceRoles",
    Effect: "Allow",
    Action: "iam:CreateServiceLinkedRole",
    Resource: [
      `arn:aws:iam::${accountId}:role/aws-service-role/elasticloadbalancing.amazonaws.com/AWSServiceRoleForElasticLoadBalancing`,
      `arn:aws:iam::${accountId}:role/aws-service-role/ecs.amazonaws.com/AWSServiceRoleForECS`,
    ],
    Condition: {
      StringLike: {
        "iam:AWSServiceName": [
          "elasticloadbalancing.amazonaws.com",
          "ecs.amazonaws.com",
        ],
      },
    },
  });
  return doc;
}

const hostActions = [
  "ec2:DescribeAccountAttributes",
  "ec2:DescribeAvailabilityZones",
  "ec2:DescribeInternetGateways",
  "elasticloadbalancing:AddTags",
  "elasticloadbalancing:DescribeAccountLimits",
  "elasticloadbalancing:DescribeLoadBalancerAttributes",
  "elasticloadbalancing:DescribeTags",
  "elasticloadbalancing:ModifyLoadBalancerAttributes",
  "elasticloadbalancing:SetSecurityGroups",
];

export function withHostActions(document) {
  const statement = document?.Statement?.find(
    (item) => item.Sid === "PreviewFormaCompute",
  );
  if (!statement) throw new Error("Policy is missing PreviewFormaCompute");
  const current = new Set(
    Array.isArray(statement.Action) ? statement.Action : [statement.Action],
  );
  const missing = hostActions.filter((action) => !current.has(action));
  if (missing.length === 0) return document;
  const doc = structuredClone(document);
  const next = doc.Statement.find((item) => item.Sid === "PreviewFormaCompute");
  next.Action = [...current, ...missing];
  return doc;
}

export function hostPolicy(document, accountId) {
  return withHostActions(withServiceLinkedRole(document, accountId));
}

export async function allowServiceLinkedRoles({ run, accountId }) {
  const policyArn = `arn:aws:iam::${accountId}:policy/preview-forma-fargate`;
  const policy = JSON.parse(
    await run([
      "iam",
      "get-policy",
      "--policy-arn",
      policyArn,
      "--output",
      "json",
    ]),
  );
  const versionId = policy.Policy.DefaultVersionId;
  const version = JSON.parse(
    await run([
      "iam",
      "get-policy-version",
      "--policy-arn",
      policyArn,
      "--version-id",
      versionId,
      "--output",
      "json",
    ]),
  );
  const raw = version.PolicyVersion.Document;
  const document =
    typeof raw === "string" ? JSON.parse(decodeURIComponent(raw)) : raw;
  const next = hostPolicy(document, accountId);
  if (next === document) return { updated: false, policyArn };
  await run([
    "iam",
    "create-policy-version",
    "--policy-arn",
    policyArn,
    "--set-as-default",
    "--policy-document",
    JSON.stringify(next),
  ]);
  return { updated: true, policyArn };
}

export function roleEnv(credentials, baseEnv) {
  const accessKey = String(credentials?.AccessKeyId ?? "");
  const secret = String(credentials?.SecretAccessKey ?? "");
  const token = String(credentials?.SessionToken ?? "");
  if (!accessKey || !secret || !token) {
    throw new Error("AssumeRole returned no credentials");
  }
  return {
    ...baseEnv,
    AWS_ACCESS_KEY_ID: accessKey,
    AWS_SECRET_ACCESS_KEY: secret,
    AWS_SESSION_TOKEN: token,
    AWS_REGION: region,
    AWS_DEFAULT_REGION: region,
  };
}

const missingMarkers = [
  "LoadBalancerNotFound",
  "TargetGroupNotFound",
  "NoSuchEntity",
  "Unable to describe task definition",
  "ClusterNotFoundException",
];

async function lookup(run, args) {
  try {
    return JSON.parse(await run(args));
  } catch (error) {
    if (
      missingMarkers.some((marker) => String(error.message).includes(marker))
    ) {
      return null;
    }
    throw error;
  }
}

async function ensureLogGroup(run, name) {
  const described = JSON.parse(
    await run([
      "logs",
      "describe-log-groups",
      "--log-group-name-prefix",
      name,
      "--region",
      region,
      "--output",
      "json",
    ]),
  );
  const exists = (described.logGroups ?? []).some(
    (group) => group.logGroupName === name,
  );
  if (!exists) {
    await run([
      "logs",
      "create-log-group",
      "--log-group-name",
      name,
      "--region",
      region,
      "--output",
      "json",
    ]);
  }
  await run([
    "logs",
    "put-retention-policy",
    "--log-group-name",
    name,
    "--retention-in-days",
    "7",
    "--region",
    region,
    "--output",
    "json",
  ]);
}

async function ensureCluster(run, name) {
  const described = JSON.parse(
    await run([
      "ecs",
      "describe-clusters",
      "--clusters",
      name,
      "--region",
      region,
      "--output",
      "json",
    ]),
  );
  const active = (described.clusters ?? []).find(
    (cluster) => cluster.clusterName === name && cluster.status === "ACTIVE",
  );
  if (active) return active;
  const created = JSON.parse(
    await run([
      "ecs",
      "create-cluster",
      "--cluster-name",
      name,
      "--region",
      region,
      "--output",
      "json",
    ]),
  );
  return created.cluster;
}

async function ensureSecurityGroup(run, { name, vpcId, description }) {
  const described = JSON.parse(
    await run([
      "ec2",
      "describe-security-groups",
      "--filters",
      `Name=group-name,Values=${name}`,
      `Name=vpc-id,Values=${vpcId}`,
      "--region",
      region,
      "--output",
      "json",
    ]),
  );
  const existing = described.SecurityGroups?.[0];
  if (existing) return existing;
  const created = JSON.parse(
    await run([
      "ec2",
      "create-security-group",
      "--group-name",
      name,
      "--description",
      description,
      "--vpc-id",
      vpcId,
      "--region",
      region,
      "--output",
      "json",
    ]),
  );
  await run([
    "ec2",
    "create-tags",
    "--resources",
    created.GroupId,
    "--tags",
    `Key=Name,Value=${name}`,
    "--region",
    region,
    "--output",
    "json",
  ]);
  return { GroupId: created.GroupId, IpPermissions: [] };
}

async function ensureIngress(run, group, rule) {
  if (ingressPresent(group, rule)) return;
  const args = [
    "ec2",
    "authorize-security-group-ingress",
    "--group-id",
    group.GroupId,
    "--protocol",
    "tcp",
    "--port",
    String(rule.port),
    "--region",
    region,
    "--output",
    "json",
  ];
  if (rule.cidr) args.push("--cidr", rule.cidr);
  if (rule.sourceGroupId) args.push("--source-group", rule.sourceGroupId);
  try {
    await run(args);
  } catch (error) {
    if (!String(error.message).includes("InvalidPermission.Duplicate")) {
      throw error;
    }
  }
}

async function ensureLoadBalancer(
  run,
  { name, subnetIds, securityGroupId, sleep },
) {
  const found = await lookup(run, [
    "elbv2",
    "describe-load-balancers",
    "--names",
    name,
    "--region",
    region,
    "--output",
    "json",
  ]);
  let balancer = found?.LoadBalancers?.[0];
  if (!balancer) {
    const created = JSON.parse(
      await run([
        "elbv2",
        "create-load-balancer",
        "--name",
        name,
        "--type",
        "application",
        "--scheme",
        "internet-facing",
        "--subnets",
        ...subnetIds,
        "--security-groups",
        securityGroupId,
        "--region",
        region,
        "--output",
        "json",
      ]),
    );
    balancer = created.LoadBalancers?.[0];
  }
  for (let attempt = 0; attempt < 24; attempt += 1) {
    if (balancer?.State?.Code === "active") return balancer;
    if (balancer?.State?.Code === "failed") {
      throw new Error("Load balancer failed");
    }
    await sleep(10000);
    const described = await lookup(run, [
      "elbv2",
      "describe-load-balancers",
      "--names",
      name,
      "--region",
      region,
      "--output",
      "json",
    ]);
    balancer = described?.LoadBalancers?.[0];
  }
  throw new Error("Load balancer did not become active");
}

async function ensureTargetGroup(run, { name, vpcId }) {
  const found = await lookup(run, [
    "elbv2",
    "describe-target-groups",
    "--names",
    name,
    "--region",
    region,
    "--output",
    "json",
  ]);
  if (found?.TargetGroups?.[0]) return found.TargetGroups[0];
  const created = JSON.parse(
    await run([
      "elbv2",
      "create-target-group",
      "--name",
      name,
      "--protocol",
      "HTTP",
      "--port",
      "3000",
      "--vpc-id",
      vpcId,
      "--target-type",
      "ip",
      "--health-check-path",
      "/api/status",
      "--health-check-protocol",
      "HTTP",
      "--matcher",
      "HttpCode=200",
      "--region",
      region,
      "--output",
      "json",
    ]),
  );
  return created.TargetGroups[0];
}

async function ensureListener(run, { loadBalancerArn, targetGroupArn }) {
  const described = JSON.parse(
    await run([
      "elbv2",
      "describe-listeners",
      "--load-balancer-arn",
      loadBalancerArn,
      "--region",
      region,
      "--output",
      "json",
    ]),
  );
  const existing = (described.Listeners ?? []).find(
    (listener) => listener.Port === 80,
  );
  if (existing) return existing;
  const created = JSON.parse(
    await run([
      "elbv2",
      "create-listener",
      "--load-balancer-arn",
      loadBalancerArn,
      "--protocol",
      "HTTP",
      "--port",
      "80",
      "--default-actions",
      `Type=forward,TargetGroupArn=${targetGroupArn}`,
      "--region",
      region,
      "--output",
      "json",
    ]),
  );
  return created.Listeners[0];
}

async function ensureExecutionRole(run, accountId) {
  const names = hostNames();
  const found = await lookup(run, [
    "iam",
    "get-role",
    "--role-name",
    names.executionRole,
    "--output",
    "json",
  ]);
  let arn = found?.Role?.Arn;
  if (!arn) {
    const created = JSON.parse(
      await run([
        "iam",
        "create-role",
        "--role-name",
        names.executionRole,
        "--assume-role-policy-document",
        JSON.stringify(executionRoleTrust()),
        "--description",
        "preview-forma task execution",
        "--output",
        "json",
      ]),
    );
    arn = created.Role.Arn;
  }
  const attached = JSON.parse(
    await run([
      "iam",
      "list-attached-role-policies",
      "--role-name",
      names.executionRole,
      "--output",
      "json",
    ]),
  );
  const present = (attached.AttachedPolicies ?? []).some(
    (policy) => policy.PolicyArn === executionPolicy,
  );
  if (!present) {
    await run([
      "iam",
      "attach-role-policy",
      "--role-name",
      names.executionRole,
      "--policy-arn",
      executionPolicy,
    ]);
  }
  if (arn !== `arn:aws:iam::${accountId}:role/${names.executionRole}`) {
    throw new Error("Execution role ARN is not preview-forma-execution");
  }
  return arn;
}

async function ensureTaskDefinition(run, accountId, image) {
  const names = hostNames();
  const document = taskDefinitionDocument({ accountId, image });
  const found = await lookup(run, [
    "ecs",
    "describe-task-definition",
    "--task-definition",
    names.taskFamily,
    "--region",
    region,
    "--output",
    "json",
  ]);
  const current = found?.taskDefinition;
  const currentImage = current?.containerDefinitions?.[0]?.image;
  if (
    current?.taskDefinitionArn &&
    currentImage === image &&
    current.executionRoleArn === document.executionRoleArn
  ) {
    return current.taskDefinitionArn;
  }
  const registered = JSON.parse(
    await run([
      "ecs",
      "register-task-definition",
      "--cli-input-json",
      JSON.stringify(document),
      "--region",
      region,
      "--output",
      "json",
    ]),
  );
  return registered.taskDefinition.taskDefinitionArn;
}

export async function ensurePreviewFormaHost({
  run,
  accountId = PREVIEW_FORMA_ACCOUNT,
  image = FORMA_IMAGE,
  sleep = async () => {},
}) {
  if (accountId !== PREVIEW_FORMA_ACCOUNT) {
    throw new Error("Refusing an unexpected AWS account");
  }
  assertFormaImage(image);
  const names = hostNames();
  const vpcs = JSON.parse(
    await run([
      "ec2",
      "describe-vpcs",
      "--filters",
      "Name=isDefault,Values=true",
      "--region",
      region,
      "--output",
      "json",
    ]),
  );
  const vpc = (vpcs.Vpcs ?? []).find((item) => item.IsDefault);
  if (!vpc?.VpcId) throw new Error("No default VPC in ap-southeast-1");
  const subnets = JSON.parse(
    await run([
      "ec2",
      "describe-subnets",
      "--filters",
      `Name=vpc-id,Values=${vpc.VpcId}`,
      "--region",
      region,
      "--output",
      "json",
    ]),
  );
  const chosen = selectPublicSubnets(subnets.Subnets);
  await ensureLogGroup(run, names.logGroup);
  await ensureCluster(run, names.cluster);
  const albGroup = await ensureSecurityGroup(run, {
    name: names.albSecurityGroup,
    vpcId: vpc.VpcId,
    description: "preview-forma load balancer",
  });
  await ensureIngress(run, albGroup, { port: 80, cidr: "0.0.0.0/0" });
  const taskGroup = await ensureSecurityGroup(run, {
    name: names.taskSecurityGroup,
    vpcId: vpc.VpcId,
    description: "preview-forma tasks",
  });
  await ensureIngress(run, taskGroup, {
    port: names.containerPort,
    sourceGroupId: albGroup.GroupId,
  });
  const balancer = await ensureLoadBalancer(run, {
    name: names.loadBalancer,
    subnetIds: chosen.map((subnet) => subnet.SubnetId),
    securityGroupId: albGroup.GroupId,
    sleep,
  });
  const targetGroup = await ensureTargetGroup(run, {
    name: names.targetGroup,
    vpcId: vpc.VpcId,
  });
  await ensureListener(run, {
    loadBalancerArn: balancer.LoadBalancerArn,
    targetGroupArn: targetGroup.TargetGroupArn,
  });
  const executionRoleArn = await ensureExecutionRole(run, accountId);
  const taskDefinitionArn = await ensureTaskDefinition(run, accountId, image);
  return {
    region,
    accountId,
    cluster: names.cluster,
    image,
    vpcId: vpc.VpcId,
    subnetIds: chosen.map((subnet) => subnet.SubnetId),
    albSecurityGroupId: albGroup.GroupId,
    taskSecurityGroupId: taskGroup.GroupId,
    albArn: balancer.LoadBalancerArn,
    albDns: balancer.DNSName,
    targetGroupArn: targetGroup.TargetGroupArn,
    executionRoleArn,
    taskDefinitionArn,
    logGroup: names.logGroup,
    containerPort: names.containerPort,
    started: false,
  };
}

function aws(args, env) {
  const result = spawnSync("aws", args, { encoding: "utf8", env });
  if (result.status !== 0) {
    throw new Error(
      `aws ${args[0]} ${args[1]} ${result.status} ${redact(`${result.stderr || ""}\n${result.stdout || ""}`)}`,
    );
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

export async function createPreviewFormaHost({
  token,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const downloaded = await downloadAwsDev(token);
  const accessKey = String(downloaded.AWS_ACCESS_KEY_ID ?? "").trim();
  const secretKey = String(downloaded.AWS_SECRET_ACCESS_KEY ?? "").trim();
  if (!accessKey || !secretKey) {
    throw new Error("Doppler aws/dev is missing the AWS key pair");
  }
  const userEnv = {
    ...process.env,
    AWS_ACCESS_KEY_ID: accessKey,
    AWS_SECRET_ACCESS_KEY: secretKey,
    AWS_REGION: region,
    AWS_DEFAULT_REGION: region,
  };
  delete userEnv.AWS_SESSION_TOKEN;
  const account = aws(
    ["sts", "get-caller-identity", "--query", "Account", "--output", "text"],
    userEnv,
  ).trim();
  if (account !== PREVIEW_FORMA_ACCOUNT) {
    throw new Error("Refusing an unexpected AWS account");
  }
  const userRun = async (args) => aws(args, userEnv);
  const policy = await allowServiceLinkedRoles({
    run: userRun,
    accountId: account,
  });
  if (policy.updated) await sleep(10000);
  const caller = aws(
    ["sts", "get-caller-identity", "--query", "Arn", "--output", "text"],
    userEnv,
  ).trim();
  const roleArn = `arn:aws:iam::${account}:role/preview-forma-deploy`;
  const assumedText = aws(
    [
      "sts",
      "assume-role",
      "--role-arn",
      roleArn,
      "--role-session-name",
      "preview-forma-host",
      "--duration-seconds",
      "3600",
      "--output",
      "json",
    ],
    userEnv,
  );
  const assumed = JSON.parse(assumedText);
  const env = roleEnv(assumed.Credentials, userEnv);
  const assumedArn = aws(
    ["sts", "get-caller-identity", "--query", "Arn", "--output", "text"],
    env,
  ).trim();
  const run = async (args) => {
    try {
      return aws(args, env);
    } catch (error) {
      const creatingCluster = args[0] === "ecs" && args[1] === "create-cluster";
      if (creatingCluster && shouldUseUserForCluster(error)) {
        return aws(args, userEnv);
      }
      throw error;
    }
  };
  const host = await ensurePreviewFormaHost({ run, accountId: account, sleep });
  return { caller, assumedArn, host };
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const log = (line) => writeSync(1, `${redact(line)}\n`);
  const token = process.env.DOPPLER_ADMIN_TOKEN ?? "";
  if (!token) {
    log("DOPPLER_ADMIN_TOKEN=absent");
    process.exit(1);
  }
  createPreviewFormaHost({ token })
    .then(({ caller, assumedArn, host }) => {
      log(`preview_forma_host_caller=${caller}`);
      log(`preview_forma_host_assumed=${assumedArn}`);
      log(`preview_forma_host_json=${JSON.stringify(host)}`);
      log("preview_forma_host_started=no");
    })
    .catch((error) => {
      log(redact(error?.message || String(error)));
      process.exit(1);
    });
}
