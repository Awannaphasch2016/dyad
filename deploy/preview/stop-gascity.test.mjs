import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRetireTarget,
  ecsInstanceId,
  gascityInstanceId,
  gascityRootVolumeId,
  retireGascity,
} from "./stop-gascity.mjs";

function instance(overrides = {}) {
  return {
    InstanceId: gascityInstanceId,
    RootDeviceName: "/dev/xvda",
    State: { Name: "running" },
    Tags: [{ Key: "Name", Value: "gascity-server" }],
    BlockDeviceMappings: [
      {
        DeviceName: "/dev/xvda",
        Ebs: { VolumeId: gascityRootVolumeId },
      },
    ],
    ...overrides,
  };
}

function described(state) {
  return {
    Reservations: [{ Instances: [instance({ State: { Name: state } })] }],
  };
}

function pageFetch() {
  return async () => ({
    status: 200,
    text: async () => "<html data-dyad-browser-bridge></html>",
  });
}

test("the retire target is the old host and not the ECS machine", () => {
  assert.notEqual(gascityInstanceId, ecsInstanceId);
  assert.deepEqual(assertRetireTarget(instance()), {
    instanceId: gascityInstanceId,
    volumeId: gascityRootVolumeId,
  });
  assert.throws(
    () => assertRetireTarget(instance({ InstanceId: ecsInstanceId })),
    /Refusing to stop instance/,
  );
  assert.throws(
    () =>
      assertRetireTarget(
        instance({
          BlockDeviceMappings: [
            { DeviceName: "/dev/xvda", Ebs: { VolumeId: "vol-other" } },
          ],
        }),
      ),
    /Refusing to snapshot volume/,
  );
  assert.throws(
    () =>
      assertRetireTarget(
        instance({ Tags: [{ Key: "Name", Value: "wewebplus-ecs" }] }),
      ),
    /Refusing instance named/,
  );
});

test("a running host is snapshotted and stopped, never terminated", async () => {
  const calls = [];
  let snapshotReads = 0;
  let instanceReads = 0;
  const aws = async (args) => {
    calls.push(args.join(" "));
    assert.equal(
      args.some((arg) => String(arg).includes("terminate")),
      false,
    );
    if (args[1] === "describe-instances") {
      instanceReads += 1;
      const state =
        instanceReads === 1
          ? "running"
          : instanceReads === 2
            ? "stopping"
            : "stopped";
      return described(state);
    }
    if (args[1] === "create-snapshot") {
      return { SnapshotId: "snap-abc123" };
    }
    if (args[1] === "describe-snapshots") {
      snapshotReads += 1;
      return {
        Snapshots: [{ State: snapshotReads < 2 ? "pending" : "completed" }],
      };
    }
    if (args[1] === "stop-instances") return { StoppingInstances: [] };
    throw new Error(`unexpected ${args.join(" ")}`);
  };
  const retired = await retireGascity({
    aws,
    fetchImpl: pageFetch(),
    sleep: async () => {},
  });
  assert.equal(retired.snapshotId, "snap-abc123");
  assert.equal(retired.state, "stopped");
  assert.equal(
    calls.some((call) => call.startsWith("ec2 stop-instances")),
    true,
  );
  assert.equal(
    calls.findIndex((call) => call.startsWith("ec2 stop-instances")) >
      calls.findIndex((call) => call.includes("describe-snapshots")),
    true,
  );
});

test("a failed page check does not snapshot or stop the host", async () => {
  const calls = [];
  await assert.rejects(
    () =>
      retireGascity({
        aws: async (args) => {
          calls.push(args.join(" "));
          return {};
        },
        fetchImpl: async () => ({ status: 404, text: async () => "missing" }),
        sleep: async () => {},
      }),
    /did not serve the Dyad page/,
  );
  assert.deepEqual(calls, []);
});

test("an already stopped host is left stopped", async () => {
  const calls = [];
  const retired = await retireGascity({
    aws: async (args) => {
      calls.push(args[1]);
      return described("stopped");
    },
    fetchImpl: pageFetch(),
    sleep: async () => {},
  });
  assert.equal(retired.snapshotId, "");
  assert.deepEqual(calls, ["describe-instances"]);
});
