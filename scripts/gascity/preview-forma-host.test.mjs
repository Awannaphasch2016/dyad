import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  FORMA_IMAGE,
  PREVIEW_FORMA_ACCOUNT,
  ensurePreviewFormaHost,
  executionRoleTrust,
  hostNames,
  ingressPresent,
  redact,
  roleEnv,
  selectPublicSubnets,
  shouldUseUserForCluster,
  taskDefinitionDocument,
} from "./preview-forma-host.mjs";

test("host names stay in ap-southeast-1 and do not start a task", () => {
  const names = hostNames();
  assert.equal(names.cluster, "preview-forma");
  assert.equal(names.containerPort, 3000);
  const document = taskDefinitionDocument({
    accountId: PREVIEW_FORMA_ACCOUNT,
    image: FORMA_IMAGE,
  });
  assert.equal(document.containerDefinitions[0].image, FORMA_IMAGE);
  assert.equal(
    document.executionRoleArn.endsWith("role/preview-forma-execution"),
    true,
  );
  assert.equal(JSON.stringify(document).includes("DATABASE_URL"), false);
  assert.equal(JSON.stringify(document).includes("wewebplus"), false);
  assert.equal(
    executionRoleTrust().Statement[0].Principal.Service,
    "ecs-tasks.amazonaws.com",
  );
  assert.equal(
    shouldUseUserForCluster(
      new Error("Unable to assume the service linked role"),
    ),
    true,
  );
});

test("public subnet selection needs two availability zones", () => {
  const subnets = [
    {
      SubnetId: "subnet-a",
      AvailabilityZone: "ap-southeast-1a",
      MapPublicIpOnLaunch: true,
      State: "available",
    },
    {
      SubnetId: "subnet-b",
      AvailabilityZone: "ap-southeast-1a",
      MapPublicIpOnLaunch: true,
      State: "available",
    },
    {
      SubnetId: "subnet-c",
      AvailabilityZone: "ap-southeast-1b",
      MapPublicIpOnLaunch: false,
      State: "available",
    },
  ];
  assert.throws(() => selectPublicSubnets(subnets), /two public subnets/);
  subnets.push({
    SubnetId: "subnet-d",
    AvailabilityZone: "ap-southeast-1b",
    MapPublicIpOnLaunch: true,
    State: "available",
  });
  assert.deepEqual(
    selectPublicSubnets(subnets).map((subnet) => subnet.SubnetId),
    ["subnet-a", "subnet-d"],
  );
});

test("ingress check recognizes the load balancer rule", () => {
  const group = {
    IpPermissions: [
      { IpProtocol: "tcp", FromPort: 80, IpRanges: [{ CidrIp: "0.0.0.0/0" }] },
    ],
  };
  assert.equal(ingressPresent(group, { port: 80, cidr: "0.0.0.0/0" }), true);
  assert.equal(
    ingressPresent(group, { port: 3000, sourceGroupId: "sg-alb" }),
    false,
  );
});

test("role credentials are redacted", () => {
  const env = roleEnv(
    {
      AccessKeyId: "ASIA1234567890123456",
      SecretAccessKey: "secret-value",
      SessionToken: "session-value",
    },
    {},
  );
  const printed = redact(JSON.stringify(env));
  assert.equal(printed.includes("ASIA1234567890123456"), false);
  assert.equal(printed.includes("secret-value"), false);
  assert.equal(printed.includes("session-value"), false);
  assert.equal(redact("dp.st.token").includes("dp.st.token"), false);
});

test("ensure host creates the load balancer and does not start a task", async () => {
  const calls = [];
  const state = {
    log: false,
    cluster: false,
    albSg: null,
    taskSg: null,
    alb: null,
    target: null,
    listener: false,
    role: false,
    policy: false,
    task: null,
  };
  const run = async (args) => {
    calls.push(args.join(" "));
    const command = `${args[0]} ${args[1]}`;
    if (command === "ec2 describe-vpcs") {
      return JSON.stringify({ Vpcs: [{ VpcId: "vpc-1", IsDefault: true }] });
    }
    if (command === "ec2 describe-subnets") {
      return JSON.stringify({
        Subnets: [
          {
            SubnetId: "subnet-a",
            AvailabilityZone: "ap-southeast-1a",
            MapPublicIpOnLaunch: true,
            State: "available",
          },
          {
            SubnetId: "subnet-b",
            AvailabilityZone: "ap-southeast-1b",
            MapPublicIpOnLaunch: true,
            State: "available",
          },
        ],
      });
    }
    if (command === "logs describe-log-groups") {
      return JSON.stringify({
        logGroups: state.log ? [{ logGroupName: "/ecs/preview-forma" }] : [],
      });
    }
    if (command === "logs create-log-group") {
      state.log = true;
      return "";
    }
    if (command === "logs put-retention-policy") return "";
    if (command === "ecs describe-clusters") {
      return JSON.stringify({
        clusters: state.cluster
          ? [{ clusterName: "preview-forma", status: "ACTIVE" }]
          : [],
      });
    }
    if (command === "ecs create-cluster") {
      state.cluster = true;
      return JSON.stringify({
        cluster: { clusterName: "preview-forma", status: "ACTIVE" },
      });
    }
    if (command === "ec2 describe-security-groups") {
      const name = args
        .find((arg) => arg.startsWith("Name=group-name"))
        ?.split("=")[2];
      const group = name === "preview-forma-alb" ? state.albSg : state.taskSg;
      return JSON.stringify({ SecurityGroups: group ? [group] : [] });
    }
    if (command === "ec2 create-security-group") {
      const name = args[args.indexOf("--group-name") + 1];
      const group = {
        GroupId: name.endsWith("alb") ? "sg-alb" : "sg-tasks",
        IpPermissions: [],
      };
      if (name.endsWith("alb")) state.albSg = group;
      else state.taskSg = group;
      return JSON.stringify({ GroupId: group.GroupId });
    }
    if (command === "ec2 create-tags") return "";
    if (command === "ec2 authorize-security-group-ingress") {
      const groupId = args[args.indexOf("--group-id") + 1];
      const port = Number(args[args.indexOf("--port") + 1]);
      const group = groupId === "sg-alb" ? state.albSg : state.taskSg;
      group.IpPermissions.push(
        port === 80
          ? {
              IpProtocol: "tcp",
              FromPort: 80,
              IpRanges: [{ CidrIp: "0.0.0.0/0" }],
            }
          : {
              IpProtocol: "tcp",
              FromPort: 3000,
              UserIdGroupPairs: [{ GroupId: "sg-alb" }],
            },
      );
      return "{}";
    }
    if (command === "elbv2 describe-load-balancers") {
      if (!state.alb) throw new Error("LoadBalancerNotFound");
      return JSON.stringify({ LoadBalancers: [state.alb] });
    }
    if (command === "elbv2 create-load-balancer") {
      state.alb = {
        LoadBalancerArn: "arn:alb",
        DNSName: "preview-forma.ap-southeast-1.elb.amazonaws.com",
        State: { Code: "active" },
      };
      return JSON.stringify({ LoadBalancers: [state.alb] });
    }
    if (command === "elbv2 describe-target-groups") {
      if (!state.target) throw new Error("TargetGroupNotFound");
      return JSON.stringify({ TargetGroups: [state.target] });
    }
    if (command === "elbv2 create-target-group") {
      state.target = { TargetGroupArn: "arn:tg" };
      return JSON.stringify({ TargetGroups: [state.target] });
    }
    if (command === "elbv2 describe-listeners") {
      return JSON.stringify({
        Listeners: state.listener
          ? [{ Port: 80, ListenerArn: "arn:listener" }]
          : [],
      });
    }
    if (command === "elbv2 create-listener") {
      state.listener = true;
      return JSON.stringify({
        Listeners: [{ Port: 80, ListenerArn: "arn:listener" }],
      });
    }
    if (command === "iam get-role") {
      if (!state.role) throw new Error("NoSuchEntity");
      return JSON.stringify({
        Role: {
          Arn: `arn:aws:iam::${PREVIEW_FORMA_ACCOUNT}:role/preview-forma-execution`,
        },
      });
    }
    if (command === "iam create-role") {
      state.role = true;
      return JSON.stringify({
        Role: {
          Arn: `arn:aws:iam::${PREVIEW_FORMA_ACCOUNT}:role/preview-forma-execution`,
        },
      });
    }
    if (command === "iam list-attached-role-policies") {
      return JSON.stringify({
        AttachedPolicies: state.policy
          ? [
              {
                PolicyArn:
                  "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
              },
            ]
          : [],
      });
    }
    if (command === "iam attach-role-policy") {
      state.policy = true;
      return "";
    }
    if (command === "ecs describe-task-definition") {
      if (!state.task) throw new Error("Unable to describe task definition");
      return JSON.stringify({ taskDefinition: state.task });
    }
    if (command === "ecs register-task-definition") {
      const document = JSON.parse(args[args.indexOf("--cli-input-json") + 1]);
      assert.equal(document.containerDefinitions[0].image, FORMA_IMAGE);
      state.task = {
        taskDefinitionArn: "arn:task",
        executionRoleArn: document.executionRoleArn,
        containerDefinitions: document.containerDefinitions,
      };
      return JSON.stringify({ taskDefinition: state.task });
    }
    throw new Error(`unexpected ${command}`);
  };

  const host = await ensurePreviewFormaHost({ run, sleep: async () => {} });
  assert.equal(host.started, false);
  assert.equal(host.albDns, "preview-forma.ap-southeast-1.elb.amazonaws.com");
  assert.equal(host.taskDefinitionArn, "arn:task");
  assert.equal(
    calls.some((call) => call.includes("run-task")),
    false,
  );
  assert.equal(
    calls.some((call) => call.includes("create-service")),
    false,
  );

  const before = calls.length;
  const again = await ensurePreviewFormaHost({ run, sleep: async () => {} });
  assert.equal(again.albDns, host.albDns);
  const second = calls.slice(before).join("\n");
  assert.equal(second.includes("create-cluster"), false);
  assert.equal(second.includes("create-load-balancer"), false);
  assert.equal(second.includes("register-task-definition"), false);
  assert.equal(second.includes("run-task"), false);
});

test("the host workflow is a one-shot and does not run a task", () => {
  const workflow = readFileSync(
    new URL("../../.github/workflows/preview-forma-host.yml", import.meta.url),
    "utf8",
  );
  assert.equal(workflow.includes("environment: ai-bots"), true);
  assert.equal(workflow.includes("DOPPLER_ADMIN_TOKEN"), true);
  assert.equal(workflow.includes("permission-actions:"), false);
  assert.equal(workflow.includes("run-task"), false);
  assert.equal(workflow.includes("create-service"), false);
  assert.equal(workflow.includes("wewebplus-ci"), false);
  assert.equal(workflow.includes("dyad/prd"), false);
});
