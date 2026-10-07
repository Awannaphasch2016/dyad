// ECS task and service shape for the canary. Secret values stay out of this
// file. The service does not publish the bridge, noVNC, or browser bridge.

export const canarySecurityGroup = "sg-0d19518d244fede2d";
export const blockedPublicPorts = [32100, 6080, 8373];

const secretNames = new Set([
  "AWS_ACCESS_KEY_ID",
  "AWS_REGION",
  "AWS_SECRET_ACCESS_KEY",
  "CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "GAS_CITY_HOST_BRIDGE_TOKEN",
  "NOVNC_PASSWORD",
  "TUNNEL_TOKEN",
  "WEWEBPLUS_DATABASE_URL",
  "WEWEBPLUS_SECRETS_KEY",
]);

const ecrHost = /^[0-9]{12}\.dkr\.ecr\.ap-southeast-1\.amazonaws\.com$/;

function awslogs(streamPrefix) {
  return {
    logDriver: "awslogs",
    options: {
      "awslogs-group": "/ecs/wewebplus-canary",
      "awslogs-region": "ap-southeast-1",
      "awslogs-stream-prefix": streamPrefix,
    },
  };
}

function assertRepositoryImage(image, repository) {
  const slash = String(image || "").indexOf("/");
  const host = slash === -1 ? "" : image.slice(0, slash);
  const rest = slash === -1 ? "" : image.slice(slash + 1);
  if (!ecrHost.test(host) || !rest.startsWith(`${repository}:`)) {
    throw new Error(`${repository} image must come from ECR in ap-southeast-1`);
  }
}

export function canaryTaskDefinition({
  dyadImage,
  supervisorImage,
  cloudflaredImage = "cloudflare/cloudflared:2026.6.1",
  secrets = [],
}) {
  assertRepositoryImage(dyadImage, "wewebplus-dyad");
  assertRepositoryImage(supervisorImage, "wewebplus-gascity");
  for (const secret of secrets) {
    if (!secretNames.has(secret.name) || !secret.valueFrom) {
      throw new Error("Canary secrets must be references");
    }
  }
  const dyadSecrets = secrets.filter(
    (secret) => secret.name !== "TUNNEL_TOKEN",
  );
  const tunnelSecrets = secrets.filter(
    (secret) => secret.name === "TUNNEL_TOKEN",
  );
  return {
    family: "wewebplus-canary",
    // Host networking uses the capacity instance's existing public address.
    // An awsvpc task interface is requester-managed and cannot take an
    // egress address, so cloudflared never reached Cloudflare. Port mappings
    // are omitted: host mode binds in the container, and the security group
    // still has no public 32100, 6080, or 8373.
    networkMode: "host",
    requiresCompatibilities: ["EC2"],
    cpu: "2048",
    memory: "8192",
    containerDefinitions: [
      {
        name: "dyad",
        image: dyadImage,
        essential: true,
        logConfiguration: awslogs("dyad"),
        linuxParameters: { sharedMemorySize: 1024 },
        environment: [
          { name: "GAS_CITY_HOST_BRIDGE_ENABLED", value: "true" },
          { name: "GAS_CITY_HOST_BRIDGE_HOST", value: "0.0.0.0" },
          { name: "GAS_CITY_HOST_BRIDGE_PORT", value: "32100" },
          { name: "DYAD_BROWSER_BRIDGE", value: "1" },
          { name: "DYAD_BROWSER_BRIDGE_PORT", value: "8373" },
          { name: "DOPPLER_CONFIG", value: "canary" },
        ],
        secrets: dyadSecrets,
        mountPoints: [
          {
            sourceVolume: "canary-user-data",
            containerPath: "/home/weaver/.config",
          },
          {
            sourceVolume: "canary-projects",
            containerPath: "/home/weaver/dyad-apps",
          },
        ],
      },
      {
        name: "gascity",
        image: supervisorImage,
        essential: true,
        logConfiguration: awslogs("gascity"),
        environment: [{ name: "WEAVER_BASE_URL", value: "http://dyad:32100" }],
        extraHosts: [{ hostname: "dyad", ipAddress: "127.0.0.1" }],
        dependsOn: [{ containerName: "dyad", condition: "START" }],
      },
      {
        name: "cloudflared",
        image: cloudflaredImage,
        essential: tunnelSecrets.length > 0,
        logConfiguration: awslogs("cloudflared"),
        command: ["tunnel", "--no-autoupdate", "run"],
        secrets: tunnelSecrets,
      },
    ],
    volumes: [
      {
        name: "canary-user-data",
        dockerVolumeConfiguration: {
          scope: "shared",
          autoprovision: true,
          driver: "local",
        },
      },
      {
        name: "canary-projects",
        dockerVolumeConfiguration: {
          scope: "shared",
          autoprovision: true,
          driver: "local",
        },
      },
    ],
  };
}

export function canaryService({ taskDefinition }) {
  return {
    serviceName: "wewebplus-canary",
    taskDefinition,
    desiredCount: 1,
    launchType: "EC2",
  };
}

export function assertPrivateBridge(rules) {
  for (const rule of rules ?? []) {
    const cidr = rule.cidr ?? "";
    const port = rule.port;
    if (cidr === "0.0.0.0/0" && blockedPublicPorts.includes(port)) {
      throw new Error(`Port ${port} is public`);
    }
  }
}
