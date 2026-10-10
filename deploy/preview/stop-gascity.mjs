// Snapshot gascity-server, then stop it. This file never terminates the instance.

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const gascityInstanceId = "i-0817f3778a5c9e1e2";
export const gascityRootVolumeId = "vol-020a3f0726876b135";
export const ecsInstanceId = "i-023d741ed3a1b3b25";

const pages = [
  "https://pre.anakwannaphaschaiyong.com",
  "https://anakwannaphaschaiyong.com",
];

function refuseTerminate(args) {
  if (args.some((arg) => String(arg).toLowerCase().includes("terminate"))) {
    throw new Error("Refusing to terminate an instance");
  }
}

export function assertRetireTarget(instance) {
  if (gascityInstanceId === ecsInstanceId) {
    throw new Error("Refusing to stop the ECS host");
  }
  if (instance?.InstanceId !== gascityInstanceId) {
    throw new Error(
      `Refusing to stop instance ${instance?.InstanceId || "unknown"}`,
    );
  }
  const root = (instance.BlockDeviceMappings || []).find(
    (mapping) => mapping.DeviceName === instance.RootDeviceName,
  );
  const volumeId = root?.Ebs?.VolumeId || "";
  if (volumeId !== gascityRootVolumeId) {
    throw new Error(`Refusing to snapshot volume ${volumeId || "unknown"}`);
  }
  const name = (instance.Tags || []).find((tag) => tag.Key === "Name")?.Value;
  if (name !== "gascity-server") {
    throw new Error(`Refusing instance named ${name || "unnamed"}`);
  }
  return { instanceId: gascityInstanceId, volumeId };
}

async function pageOk(fetchImpl, url) {
  const response = await fetchImpl(url, { redirect: "manual" });
  const text = await response.text();
  return response.status === 200 && text.includes("data-dyad-browser-bridge");
}

async function requirePages(fetchImpl) {
  for (const url of pages) {
    if (!(await pageOk(fetchImpl, url))) {
      throw new Error(`${new URL(url).hostname} did not serve the Dyad page`);
    }
    console.log(`page_ok status=200 host=${new URL(url).hostname}`);
  }
}

function instanceFrom(body) {
  return body?.Reservations?.[0]?.Instances?.[0];
}

async function poll(read, accept, sleep, label, attempts) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const value = await read();
    console.log(`${label}=${value} attempt=${attempt}`);
    if (accept(value)) return value;
    if (value === "error" || value === "failed") {
      throw new Error(`${label} ${value}`);
    }
    await sleep(30_000);
  }
  throw new Error(`${label} did not finish`);
}

export async function retireGascity({ aws, fetchImpl = fetch, sleep }) {
  const pause =
    sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  await requirePages(fetchImpl);
  const described = await aws([
    "ec2",
    "describe-instances",
    "--instance-ids",
    gascityInstanceId,
    "--output",
    "json",
  ]);
  const instance = instanceFrom(described);
  const target = assertRetireTarget(instance);
  const state = instance.State?.Name || "";
  if (state === "stopped") {
    console.log(`gascity_state=stopped instance=${target.instanceId}`);
    return { ...target, snapshotId: "", state };
  }
  if (state !== "running") {
    throw new Error(`Refusing to stop instance in state ${state || "unknown"}`);
  }
  const created = await aws([
    "ec2",
    "create-snapshot",
    "--volume-id",
    target.volumeId,
    "--description",
    "gascity-server root before stop",
    "--tag-specifications",
    "ResourceType=snapshot,Tags=[{Key=Name,Value=gascity-server-root-before-stop},{Key=InstanceId,Value=i-0817f3778a5c9e1e2}]",
    "--output",
    "json",
  ]);
  const snapshotId = created.SnapshotId || "";
  if (!/^snap-[0-9a-f]+$/.test(snapshotId)) {
    throw new Error("Snapshot id missing");
  }
  console.log(`snapshot_id=${snapshotId}`);
  await poll(
    async () => {
      const body = await aws([
        "ec2",
        "describe-snapshots",
        "--snapshot-ids",
        snapshotId,
        "--output",
        "json",
      ]);
      return body.Snapshots?.[0]?.State || "";
    },
    (value) => value === "completed",
    pause,
    "snapshot_state",
    120,
  );
  await aws([
    "ec2",
    "stop-instances",
    "--instance-ids",
    target.instanceId,
    "--output",
    "json",
  ]);
  await poll(
    async () => {
      const body = await aws([
        "ec2",
        "describe-instances",
        "--instance-ids",
        target.instanceId,
        "--output",
        "json",
      ]);
      return instanceFrom(body)?.State?.Name || "";
    },
    (value) => value === "stopped",
    pause,
    "gascity_state",
    40,
  );
  await requirePages(fetchImpl);
  return { ...target, snapshotId, state: "stopped" };
}

function awsCli(args) {
  refuseTerminate(args);
  const stdout = execFileSync("aws", args, { encoding: "utf8" });
  if (!stdout.trim()) return {};
  return JSON.parse(stdout);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.env.AWS_DEFAULT_REGION =
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    "ap-southeast-1";
  try {
    const retired = await retireGascity({ aws: awsCli });
    console.log(
      `gascity_stopped=1 instance=${retired.instanceId} snapshot=${retired.snapshotId || "existing"}`,
    );
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    console.error(text.split("\n")[0]);
    process.exit(1);
  }
}
