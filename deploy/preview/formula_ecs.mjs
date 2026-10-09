// Deploy the formula preview container to one ECS service.
// Prints the load balancer URL. Does not print secret values.

import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

export const REGION = "ap-southeast-1";
export const CLUSTER = "wewebplus-formula-preview";
export const SERVICE = "formula-preview";
export const REPOSITORY = "dyad-formula-preview";
export const SECRET_NAME = "wewebplus/formula-preview";
export const IDLE_TIMEOUT_SECONDS = "3600";

const VPC_NAME = "wewebplus-formula-preview";
const ALB_NAME = "formula-preview";
const TARGET_GROUP = "formula-preview";
const ALB_SG = "formula-preview-alb";
const TASK_SG = "formula-preview-task";
const LOG_GROUP = "/ecs/formula-preview";
const EXECUTION_ROLE = "formula-preview-execution";
const TASK_ROLE = "formula-preview-task";
const IMAGE_PATTERN =
  /^[0-9]{12}\.dkr\.ecr\.ap-southeast-1\.amazonaws\.com\/dyad-formula-preview@sha256:[a-f0-9]{64}$/;

export const FORMULA_ROLE_ARN =
  /^arn:aws:iam::[0-9]{12}:role\/[A-Za-z0-9+=,.@_-]+$/;

export function formulaRoleArn(env = {}, download = {}) {
  for (const value of [
    env.AWS_PREVIEW_FORMULA_ROLE_ARN,
    download.AWS_PREVIEW_FORMULA_ROLE_ARN,
  ]) {
    if (typeof value === "string" && FORMULA_ROLE_ARN.test(value.trim())) {
      return value.trim();
    }
  }
  return "";
}

const COPIED_SECRETS = [
  "WEWEBPLUS_DATABASE_URL",
  "WEWEBPLUS_SECRETS_KEY",
  "CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
];

const OPTIONAL_SECRETS = [
  "GAS_CITY_SUPERVISOR_URL",
  "GAS_CITY_CITY_NAME",
  "GAS_CITY_CITY_WRITE_GRANT",
];

const GENERATED_SECRETS = [
  ["NOVNC_PASSWORD", 16],
  ["GAS_CITY_HOST_BRIDGE_TOKEN", 32],
];

export const FORMULA_ENVIRONMENT = [
  { name: "DYAD_BROWSER_BRIDGE", value: "1" },
  { name: "DYAD_BROWSER_BRIDGE_PORT", value: "8373" },
  { name: "DYAD_BROWSER_BRIDGE_HOST", value: "0.0.0.0" },
  { name: "GAS_CITY_HOST_BRIDGE_ENABLED", value: "true" },
  { name: "GAS_CITY_HOST_BRIDGE_HOST", value: "0.0.0.0" },
  { name: "GAS_CITY_HOST_BRIDGE_PORT", value: "32100" },
  { name: "AWS_REGION", value: "ap-southeast-1" },
];

export class AwsError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "AwsError";
    this.code = code;
  }
}

function defaultRandom(bytes) {
  return randomBytes(bytes).toString("hex");
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function assertFormulaImage(image) {
  if (!IMAGE_PATTERN.test(image)) {
    throw new Error(
      "Formula task image must be the ECR digest in ap-southeast-1",
    );
  }
}

export function parseShellExports(text) {
  const env = {};
  for (const line of String(text).split("\n")) {
    if (!line.startsWith("export ")) continue;
    const body = line.slice("export ".length);
    const eq = body.indexOf("=");
    if (eq <= 0) continue;
    const key = body.slice(0, eq);
    if (!/^[A-Z0-9_]+$/.test(key)) continue;
    env[key] = unquoteShell(body.slice(eq + 1));
  }
  return env;
}

function unquoteShell(raw) {
  if (raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1).replaceAll("'\\''", "'");
  }
  return raw;
}

export function mergeFormulaSecrets(
  runtime,
  existing = {},
  randomHex = defaultRandom,
) {
  if (!runtime.WEWEBPLUS_DATABASE_URL) {
    throw new Error(
      "Neon preview branch was not attached. WEWEBPLUS_DATABASE_URL is missing.",
    );
  }
  const values = {};
  for (const key of [...COPIED_SECRETS, ...OPTIONAL_SECRETS]) {
    const value = runtime[key];
    if (typeof value !== "string" || value.length === 0) continue;
    if (value.includes("\n") || value.includes("\0")) {
      throw new Error(`Refusing to store ${key}`);
    }
    values[key] = value;
  }
  if (!values.WEWEBPLUS_DATABASE_URL) {
    throw new Error(
      "Neon preview branch was not attached. WEWEBPLUS_DATABASE_URL is missing.",
    );
  }
  for (const [key, bytes] of GENERATED_SECRETS) {
    const previous = existing[key];
    values[key] =
      typeof previous === "string" && previous.length > 0
        ? previous
        : randomHex(bytes);
  }
  return values;
}

export function buildTaskDefinition({
  image,
  secretArn,
  secretKeys,
  executionRoleArn,
  taskRoleArn,
}) {
  assertFormulaImage(image);
  const environmentNames = new Set(
    FORMULA_ENVIRONMENT.map((item) => item.name),
  );
  const secrets = [...secretKeys].sort().map((name) => {
    if (environmentNames.has(name)) {
      throw new Error(`Refusing to store ${name} as both env and secret`);
    }
    return { name, valueFrom: `${secretArn}:${name}::` };
  });
  return {
    family: SERVICE,
    networkMode: "awsvpc",
    requiresCompatibilities: ["FARGATE"],
    cpu: "2048",
    memory: "8192",
    ephemeralStorage: { sizeInGiB: 40 },
    runtimePlatform: {
      cpuArchitecture: "X86_64",
      operatingSystemFamily: "LINUX",
    },
    executionRoleArn,
    taskRoleArn,
    containerDefinitions: [
      {
        name: "dyad",
        image,
        essential: true,
        portMappings: [{ containerPort: 8373, protocol: "tcp" }],
        environment: FORMULA_ENVIRONMENT,
        secrets,
        linuxParameters: { sharedMemorySize: 1024 },
        logConfiguration: {
          logDriver: "awslogs",
          options: {
            "awslogs-group": LOG_GROUP,
            "awslogs-region": REGION,
            "awslogs-stream-prefix": "dyad",
          },
        },
      },
    ],
  };
}

export function serviceDefinition({
  mode,
  taskDefinitionArn,
  subnets,
  securityGroupId,
  targetGroupArn,
}) {
  const network = {
    cluster: CLUSTER,
    desiredCount: 1,
    platformVersion: "1.4.0",
    healthCheckGracePeriodSeconds: 180,
    deploymentConfiguration: {
      maximumPercent: 200,
      minimumHealthyPercent: 100,
      deploymentCircuitBreaker: { enable: true, rollback: true },
    },
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets,
        securityGroups: [securityGroupId],
        assignPublicIp: "ENABLED",
      },
    },
  };
  if (mode === "create") {
    return {
      ...network,
      serviceName: SERVICE,
      taskDefinition: taskDefinitionArn,
      launchType: "FARGATE",
      loadBalancers: [
        {
          targetGroupArn,
          containerName: "dyad",
          containerPort: 8373,
        },
      ],
    };
  }
  return {
    ...network,
    service: SERVICE,
    taskDefinition: taskDefinitionArn,
    forceNewDeployment: true,
  };
}

export function ingressChanges(permissions, expected) {
  const revoke = [];
  let present = false;
  for (const permission of permissions) {
    if (permissionMatches(permission, expected)) present = true;
    else revoke.push(permission);
  }
  return { revoke, authorize: !present };
}

function permissionMatches(permission, expected) {
  if (permission.IpProtocol !== "tcp") return false;
  if (
    permission.FromPort !== expected.port ||
    permission.ToPort !== expected.port
  ) {
    return false;
  }
  const ranges = permission.IpRanges || [];
  const groups = permission.UserIdGroupPairs || [];
  if (expected.cidr) {
    return (
      ranges.length === 1 &&
      ranges[0].CidrIp === expected.cidr &&
      groups.length === 0
    );
  }
  return (
    groups.length === 1 &&
    groups[0].GroupId === expected.groupId &&
    ranges.length === 0
  );
}

function named(resources, name) {
  return (resources || []).filter((resource) =>
    (resource.Tags || []).some(
      (tag) => tag.Key === "Name" && tag.Value === name,
    ),
  );
}

async function withJsonFile(value, fn) {
  const dir = await mkdtemp(join(tmpdir(), "formula-ecs-"));
  const file = join(dir, "input.json");
  await writeFile(file, JSON.stringify(value), { mode: 0o600 });
  try {
    return await fn(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function callIgnoring(run, args, codes) {
  try {
    return await run(args);
  } catch (error) {
    if (error && codes.includes(error.code)) return null;
    throw error;
  }
}

async function accountId(run) {
  const identity = await run(["sts", "get-caller-identity"]);
  if (!/^[0-9]{12}$/.test(identity.Account || "")) {
    throw new Error("AWS account id was not available");
  }
  return identity.Account;
}

export async function ensureRepository(run) {
  const account = await accountId(run);
  try {
    await run([
      "ecr",
      "describe-repositories",
      "--repository-names",
      REPOSITORY,
    ]);
  } catch (error) {
    if (error.code !== "RepositoryNotFoundException") throw error;
    await run([
      "ecr",
      "create-repository",
      "--repository-name",
      REPOSITORY,
      "--image-tag-mutability",
      "MUTABLE",
    ]);
  }
  return `${account}.dkr.ecr.${REGION}.amazonaws.com/${REPOSITORY}`;
}

async function ensureVpc(run) {
  const described = await run([
    "ec2",
    "describe-vpcs",
    "--filters",
    `Name=tag:Name,Values=${VPC_NAME}`,
  ]);
  const existing = named(described.Vpcs, VPC_NAME)[0];
  if (existing) return existing.VpcId;
  const created = await run([
    "ec2",
    "create-vpc",
    "--cidr-block",
    "10.42.0.0/16",
  ]);
  const vpcId = created.Vpc.VpcId;
  await run([
    "ec2",
    "create-tags",
    "--resources",
    vpcId,
    "--tags",
    `Key=Name,Value=${VPC_NAME}`,
  ]);
  await run([
    "ec2",
    "modify-vpc-attribute",
    "--vpc-id",
    vpcId,
    "--enable-dns-support",
    "Value=true",
  ]);
  await run([
    "ec2",
    "modify-vpc-attribute",
    "--vpc-id",
    vpcId,
    "--enable-dns-hostnames",
    "Value=true",
  ]);
  return vpcId;
}

async function ensureGateway(run, vpcId) {
  const described = await run([
    "ec2",
    "describe-internet-gateways",
    "--filters",
    `Name=tag:Name,Values=${VPC_NAME}`,
  ]);
  let gateway = named(described.InternetGateways, VPC_NAME)[0];
  if (!gateway) {
    const created = await run(["ec2", "create-internet-gateway"]);
    gateway = created.InternetGateway;
    await run([
      "ec2",
      "create-tags",
      "--resources",
      gateway.InternetGatewayId,
      "--tags",
      `Key=Name,Value=${VPC_NAME}`,
    ]);
  }
  const attached = (gateway.Attachments || []).some(
    (item) => item.VpcId === vpcId,
  );
  if (!attached) {
    await callIgnoring(
      run,
      [
        "ec2",
        "attach-internet-gateway",
        "--internet-gateway-id",
        gateway.InternetGatewayId,
        "--vpc-id",
        vpcId,
      ],
      ["Resource.AlreadyAssociated"],
    );
  }
  return gateway.InternetGatewayId;
}

async function availabilityZones(run) {
  const described = await run([
    "ec2",
    "describe-availability-zones",
    "--filters",
    `Name=region-name,Values=${REGION}`,
    "Name=state,Values=available",
  ]);
  const names = (described.AvailabilityZones || [])
    .map((zone) => zone.ZoneName)
    .sort();
  if (names.length < 2) {
    throw new Error(`Need two availability zones in ${REGION}`);
  }
  return names.slice(0, 2);
}

async function ensureSubnet(run, { vpcId, zone, index }) {
  const name = `${VPC_NAME}-${index === 0 ? "a" : "b"}`;
  const described = await run([
    "ec2",
    "describe-subnets",
    "--filters",
    `Name=vpc-id,Values=${vpcId}`,
    `Name=tag:Name,Values=${name}`,
  ]);
  const existing = named(described.Subnets, name).find(
    (subnet) => subnet.VpcId === vpcId,
  );
  if (existing) return existing.SubnetId;
  const created = await run([
    "ec2",
    "create-subnet",
    "--vpc-id",
    vpcId,
    "--cidr-block",
    `10.42.${index + 1}.0/24`,
    "--availability-zone",
    zone,
  ]);
  const subnetId = created.Subnet.SubnetId;
  await run([
    "ec2",
    "create-tags",
    "--resources",
    subnetId,
    "--tags",
    `Key=Name,Value=${name}`,
  ]);
  await run([
    "ec2",
    "modify-subnet-attribute",
    "--subnet-id",
    subnetId,
    "--map-public-ip-on-launch",
  ]);
  return subnetId;
}

async function ensureRoutes(run, { vpcId, gatewayId, subnets }) {
  const described = await run([
    "ec2",
    "describe-route-tables",
    "--filters",
    `Name=vpc-id,Values=${vpcId}`,
    `Name=tag:Name,Values=${VPC_NAME}`,
  ]);
  let table = named(described.RouteTables, VPC_NAME).find(
    (item) => item.VpcId === vpcId,
  );
  if (!table) {
    const created = await run(["ec2", "create-route-table", "--vpc-id", vpcId]);
    table = created.RouteTable;
    table.Routes = table.Routes || [];
    table.Associations = table.Associations || [];
    await run([
      "ec2",
      "create-tags",
      "--resources",
      table.RouteTableId,
      "--tags",
      `Key=Name,Value=${VPC_NAME}`,
    ]);
  }
  const hasDefault = (table.Routes || []).some(
    (route) =>
      route.DestinationCidrBlock === "0.0.0.0/0" &&
      route.GatewayId === gatewayId,
  );
  if (!hasDefault) {
    await callIgnoring(
      run,
      [
        "ec2",
        "create-route",
        "--route-table-id",
        table.RouteTableId,
        "--destination-cidr-block",
        "0.0.0.0/0",
        "--gateway-id",
        gatewayId,
      ],
      ["RouteAlreadyExists"],
    );
  }
  const associated = new Set(
    (table.Associations || []).map((item) => item.SubnetId).filter(Boolean),
  );
  for (const subnetId of subnets) {
    if (associated.has(subnetId)) continue;
    await callIgnoring(
      run,
      [
        "ec2",
        "associate-route-table",
        "--route-table-id",
        table.RouteTableId,
        "--subnet-id",
        subnetId,
      ],
      ["Resource.AlreadyAssociated"],
    );
  }
}

async function ensureSecurityGroup(run, { vpcId, name, description }) {
  const described = await run([
    "ec2",
    "describe-security-groups",
    "--filters",
    `Name=vpc-id,Values=${vpcId}`,
    `Name=group-name,Values=${name}`,
  ]);
  const existing = (described.SecurityGroups || []).find(
    (group) => group.GroupName === name && group.VpcId === vpcId,
  );
  if (existing) return existing.GroupId;
  const created = await run([
    "ec2",
    "create-security-group",
    "--group-name",
    name,
    "--description",
    description,
    "--vpc-id",
    vpcId,
  ]);
  await run([
    "ec2",
    "create-tags",
    "--resources",
    created.GroupId,
    "--tags",
    `Key=Name,Value=${name}`,
  ]);
  return created.GroupId;
}

async function applyIngress(run, groupId, expected) {
  const described = await run([
    "ec2",
    "describe-security-groups",
    "--group-ids",
    groupId,
  ]);
  const group = (described.SecurityGroups || []).find(
    (item) => item.GroupId === groupId,
  );
  const { revoke, authorize } = ingressChanges(
    group?.IpPermissions || [],
    expected,
  );
  for (const permission of revoke) {
    await run([
      "ec2",
      "revoke-security-group-ingress",
      "--group-id",
      groupId,
      "--ip-permissions",
      JSON.stringify([permission]),
    ]);
  }
  if (!authorize) return;
  const args = [
    "ec2",
    "authorize-security-group-ingress",
    "--group-id",
    groupId,
    "--protocol",
    "tcp",
    "--port",
    String(expected.port),
  ];
  if (expected.cidr) args.push("--cidr", expected.cidr);
  else args.push("--source-group", expected.groupId);
  await callIgnoring(run, args, ["InvalidPermission.Duplicate"]);
}

async function ensureLoadBalancer(run, { subnets, securityGroupId }) {
  try {
    const described = await run([
      "elbv2",
      "describe-load-balancers",
      "--names",
      ALB_NAME,
    ]);
    const existing = described.LoadBalancers?.[0];
    if (existing) {
      await run([
        "elbv2",
        "wait",
        "load-balancer-available",
        "--load-balancer-arns",
        existing.LoadBalancerArn,
      ]);
      return { arn: existing.LoadBalancerArn, dns: existing.DNSName };
    }
  } catch (error) {
    if (error.code !== "LoadBalancerNotFound") throw error;
  }
  const created = await run([
    "elbv2",
    "create-load-balancer",
    "--name",
    ALB_NAME,
    "--scheme",
    "internet-facing",
    "--type",
    "application",
    "--subnets",
    ...subnets,
    "--security-groups",
    securityGroupId,
  ]);
  const balancer = created.LoadBalancers[0];
  await run([
    "elbv2",
    "wait",
    "load-balancer-available",
    "--load-balancer-arns",
    balancer.LoadBalancerArn,
  ]);
  return { arn: balancer.LoadBalancerArn, dns: balancer.DNSName };
}

async function ensureTargetGroup(run, vpcId) {
  try {
    const described = await run([
      "elbv2",
      "describe-target-groups",
      "--names",
      TARGET_GROUP,
    ]);
    if (described.TargetGroups?.[0])
      return described.TargetGroups[0].TargetGroupArn;
  } catch (error) {
    if (error.code !== "TargetGroupNotFound") throw error;
  }
  const created = await run([
    "elbv2",
    "create-target-group",
    "--name",
    TARGET_GROUP,
    "--protocol",
    "HTTP",
    "--port",
    "8373",
    "--vpc-id",
    vpcId,
    "--target-type",
    "ip",
    "--health-check-protocol",
    "HTTP",
    "--health-check-path",
    "/",
    "--health-check-port",
    "8373",
    "--matcher",
    "HttpCode=200",
  ]);
  return created.TargetGroups[0].TargetGroupArn;
}

async function ensureListener(run, { loadBalancerArn, targetGroupArn }) {
  const described = await run([
    "elbv2",
    "describe-listeners",
    "--load-balancer-arn",
    loadBalancerArn,
  ]);
  const existing = (described.Listeners || []).find(
    (listener) => listener.Port === 80,
  );
  if (existing) return;
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
    JSON.stringify([{ Type: "forward", TargetGroupArn: targetGroupArn }]),
  ]);
}

async function ensureCluster(run) {
  const described = await run([
    "ecs",
    "describe-clusters",
    "--clusters",
    CLUSTER,
  ]);
  const active = (described.clusters || []).find(
    (cluster) => cluster.status === "ACTIVE",
  );
  if (active) return;
  await run(["ecs", "create-cluster", "--cluster-name", CLUSTER]);
}

async function ensureLogGroup(run) {
  const described = await run([
    "logs",
    "describe-log-groups",
    "--log-group-name-prefix",
    LOG_GROUP,
  ]);
  const existing = (described.logGroups || []).some(
    (group) => group.logGroupName === LOG_GROUP,
  );
  if (existing) return;
  await run(["logs", "create-log-group", "--log-group-name", LOG_GROUP]);
}

async function ensureRole(run, { name, sleep }) {
  try {
    const existing = await run(["iam", "get-role", "--role-name", name]);
    return existing.Role.Arn;
  } catch (error) {
    if (error.code !== "NoSuchEntity") throw error;
  }
  const trust = {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { Service: "ecs-tasks.amazonaws.com" },
        Action: "sts:AssumeRole",
      },
    ],
  };
  let arn = "";
  await withJsonFile(trust, async (file) => {
    const created = await run([
      "iam",
      "create-role",
      "--role-name",
      name,
      "--assume-role-policy-document",
      `file://${file}`,
    ]);
    arn = created.Role.Arn;
  });
  await sleep(5000);
  return arn;
}

async function ensureExecutionPolicy(run, { account }) {
  await run([
    "iam",
    "attach-role-policy",
    "--role-name",
    EXECUTION_ROLE,
    "--policy-arn",
    "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
  ]);
  const policy = {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: ["secretsmanager:GetSecretValue"],
        Resource: `arn:aws:secretsmanager:${REGION}:${account}:secret:${SECRET_NAME}*`,
      },
    ],
  };
  await withJsonFile(policy, async (file) => {
    await run([
      "iam",
      "put-role-policy",
      "--role-name",
      EXECUTION_ROLE,
      "--policy-name",
      "formula-preview-secrets",
      "--policy-document",
      `file://${file}`,
    ]);
  });
}

async function ensureSecret(run, runtime, randomHex) {
  let arn = "";
  let existing = {};
  try {
    const described = await run([
      "secretsmanager",
      "describe-secret",
      "--secret-id",
      SECRET_NAME,
    ]);
    arn = described.ARN;
    const current = await run([
      "secretsmanager",
      "get-secret-value",
      "--secret-id",
      SECRET_NAME,
    ]);
    const parsed = JSON.parse(current.SecretString);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Formula preview secret is not a JSON object");
    }
    existing = parsed;
  } catch (error) {
    if (error.code !== "ResourceNotFoundException") throw error;
  }
  const values = mergeFormulaSecrets(runtime, existing, randomHex);
  await withJsonFile(values, async (file) => {
    if (!arn) {
      const created = await run([
        "secretsmanager",
        "create-secret",
        "--name",
        SECRET_NAME,
        "--secret-string",
        `file://${file}`,
      ]);
      arn = created.ARN;
      return;
    }
    await run([
      "secretsmanager",
      "put-secret-value",
      "--secret-id",
      SECRET_NAME,
      "--secret-string",
      `file://${file}`,
    ]);
  });
  return { arn, keys: Object.keys(values) };
}

async function registerTask(run, task, sleep) {
  let last;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return await withJsonFile(task, async (file) =>
        run([
          "ecs",
          "register-task-definition",
          "--cli-input-json",
          `file://${file}`,
        ]),
      );
    } catch (error) {
      last = error;
      if (
        !["AccessDeniedException", "ClientException"].includes(error.code) ||
        attempt === 5
      ) {
        throw error;
      }
      await sleep(2000);
    }
  }
  throw last;
}

async function ensureService(run, input) {
  const described = await run([
    "ecs",
    "describe-services",
    "--cluster",
    CLUSTER,
    "--services",
    SERVICE,
  ]);
  const active = (described.services || []).find(
    (service) => service.serviceName === SERVICE && service.status === "ACTIVE",
  );
  const mode = active ? "update" : "create";
  const definition = serviceDefinition({ mode, ...input });
  if (definition.desiredCount !== 1) {
    throw new Error("Formula preview desired count must stay 1");
  }
  await withJsonFile(definition, async (file) => {
    const command = mode === "create" ? "create-service" : "update-service";
    await run(["ecs", command, "--cli-input-json", `file://${file}`]);
  });
}

export async function syncFormulaService(run, options) {
  const image = options.image;
  const runtime = parseShellExports(options.runtimeText);
  const sleep = options.sleep || defaultSleep;
  const randomHex = options.randomHex || defaultRandom;
  assertFormulaImage(image);
  const account = await accountId(run);
  if (!image.startsWith(`${account}.dkr.ecr.${REGION}.amazonaws.com/`)) {
    throw new Error("Formula task image is not in this AWS account");
  }
  await ensureRepository(run);
  const vpcId = await ensureVpc(run);
  const gatewayId = await ensureGateway(run, vpcId);
  const zones = await availabilityZones(run);
  const subnets = [];
  for (const [index, zone] of zones.entries()) {
    subnets.push(await ensureSubnet(run, { vpcId, zone, index }));
  }
  await ensureRoutes(run, { vpcId, gatewayId, subnets });
  const albGroup = await ensureSecurityGroup(run, {
    vpcId,
    name: ALB_SG,
    description: "Formula preview load balancer",
  });
  const taskGroup = await ensureSecurityGroup(run, {
    vpcId,
    name: TASK_SG,
    description: "Formula preview task",
  });
  await applyIngress(run, albGroup, { port: 80, cidr: "0.0.0.0/0" });
  await applyIngress(run, taskGroup, { port: 8373, groupId: albGroup });
  const loadBalancer = await ensureLoadBalancer(run, {
    subnets,
    securityGroupId: albGroup,
  });
  if (
    !/^[A-Za-z0-9.-]+\.ap-southeast-1\.elb\.amazonaws\.com$/.test(
      loadBalancer.dns || "",
    )
  ) {
    throw new Error("Load balancer DNS name was not in ap-southeast-1");
  }
  await run([
    "elbv2",
    "modify-load-balancer-attributes",
    "--load-balancer-arn",
    loadBalancer.arn,
    "--attributes",
    `Key=idle_timeout.timeout_seconds,Value=${IDLE_TIMEOUT_SECONDS}`,
  ]);
  const targetGroupArn = await ensureTargetGroup(run, vpcId);
  await run([
    "elbv2",
    "modify-target-group",
    "--target-group-arn",
    targetGroupArn,
    "--health-check-protocol",
    "HTTP",
    "--health-check-port",
    "8373",
    "--health-check-path",
    "/",
    "--matcher",
    "HttpCode=200",
  ]);
  await ensureListener(run, {
    loadBalancerArn: loadBalancer.arn,
    targetGroupArn,
  });
  await ensureCluster(run);
  await ensureLogGroup(run);
  const executionRoleArn = await ensureRole(run, {
    name: EXECUTION_ROLE,
    sleep,
  });
  const taskRoleArn = await ensureRole(run, { name: TASK_ROLE, sleep });
  await ensureExecutionPolicy(run, { account });
  const secret = await ensureSecret(run, runtime, randomHex);
  const task = buildTaskDefinition({
    image,
    secretArn: secret.arn,
    secretKeys: secret.keys,
    executionRoleArn,
    taskRoleArn,
  });
  const registered = await registerTask(run, task, sleep);
  await ensureService(run, {
    taskDefinitionArn: registered.taskDefinition.taskDefinitionArn,
    subnets,
    securityGroupId: taskGroup,
    targetGroupArn,
  });
  await run([
    "ecs",
    "wait",
    "services-stable",
    "--cluster",
    CLUSTER,
    "--services",
    SERVICE,
  ]);
  console.error(`formula service ${SERVICE} desired count 1`);
  return { url: `http://${loadBalancer.dns}` };
}

function cliRunner() {
  return (args) =>
    new Promise((resolve, reject) => {
      const child = spawn(
        "aws",
        ["--region", REGION, "--output", "json", ...args],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", reject);
      child.on("close", (status) => {
        if (status !== 0) {
          const match = stderr.match(/\(([A-Za-z0-9.]+)\)/);
          const code = match?.[1] || "Error";
          const message =
            args[0] === "secretsmanager"
              ? `secretsmanager ${args[1]} failed (${code})`
              : stderr.trim() || `aws exited ${status}`;
          reject(new AwsError(message, code));
          return;
        }
        if (!stdout.trim()) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch (error) {
          reject(error);
        }
      });
    });
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? "" : process.argv[index + 1] || "";
}

async function downloadDoppler(token, project = "", config = "") {
  const params = new URLSearchParams({ format: "json" });
  if (project) params.set("project", project);
  if (config) params.set("config", config);
  const response = await fetch(
    `https://api.doppler.com/v3/configs/config/secrets/download?${params}`,
    {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    },
  );
  if (!response.ok) {
    const where = project ? ` project=${project} config=${config}` : "";
    throw new Error(`Doppler download failed (${response.status})${where}`);
  }
  return response.json();
}

async function writeRoleArn() {
  const out = arg("--out");
  if (!out) throw new Error("Missing --out");
  const downloads = [];
  if (process.env.DOPPLER_TOKEN) {
    downloads.push(await downloadDoppler(process.env.DOPPLER_TOKEN));
  }
  const admin = process.env.DOPPLER_ADMIN_TOKEN || "";
  if (admin) {
    process.stdout.write("doppler admin token present\n");
    for (const [project, config] of [
      ["dyad", "preview"],
      ["dyad", "prd"],
    ]) {
      try {
        downloads.push(await downloadDoppler(admin, project, config));
        process.stdout.write(
          `doppler read project=${project} config=${config}\n`,
        );
      } catch (error) {
        process.stderr.write(
          `${error instanceof Error ? error.message : "Doppler download failed"}\n`,
        );
      }
    }
  } else {
    process.stdout.write("doppler admin token absent\n");
  }
  let roleArn = formulaRoleArn(process.env, {});
  if (!roleArn) {
    for (const download of downloads) {
      roleArn = formulaRoleArn({}, download);
      if (roleArn) break;
    }
  }
  if (!roleArn) {
    console.error(
      "AWS_PREVIEW_FORMULA_ROLE_ARN is absent from Doppler and from the GitHub secret.",
    );
    console.error(
      "The role must trust repo:Awannaphasch2016@28061800/dyad@1384672033:ref:refs/heads/cursor/formula-config-ui-55d6",
    );
    process.exitCode = 1;
    return;
  }
  writeFileSync(out, roleArn, { mode: 0o600 });
  process.stdout.write("present\n");
}

async function main() {
  const command = process.argv[2];
  const run = cliRunner();
  if (command === "role-arn") {
    await writeRoleArn();
    return;
  }
  if (command === "ensure-repository") {
    const repository = await ensureRepository(run);
    process.stdout.write(`repository=${repository}\n`);
    return;
  }
  if (command === "sync") {
    const image = arg("--image");
    const runtimePath = arg("--runtime");
    if (!runtimePath) throw new Error("Missing --runtime");
    const runtimeText = readFileSync(runtimePath, "utf8");
    const result = await syncFormulaService(run, { image, runtimeText });
    process.stdout.write(`url=${result.url}\n`);
    return;
  }
  throw new Error(
    "Usage: formula_ecs.mjs <role-arn|ensure-repository|sync> [--out file] [--image digest] [--runtime file]",
  );
}

if (
  process.argv[1]?.endsWith(`${join("deploy", "preview", "formula_ecs.mjs")}`)
) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Formula preview deploy failed",
    );
    process.exit(1);
  });
}
