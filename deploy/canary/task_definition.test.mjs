import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPrivateBridge,
  canaryService,
  canaryTaskDefinition,
} from "./task_definition.mjs";

const images = {
  dyadImage:
    "123456789012.dkr.ecr.ap-southeast-1.amazonaws.com/wewebplus-dyad:canary",
  supervisorImage:
    "123456789012.dkr.ecr.ap-southeast-1.amazonaws.com/wewebplus-gascity:supervisor",
};

test("the canary task keeps the bridge private and the supervisor on dyad:32100", () => {
  const task = canaryTaskDefinition(images);
  const dyad = task.containerDefinitions.find((item) => item.name === "dyad");
  const gascity = task.containerDefinitions.find(
    (item) => item.name === "gascity",
  );
  assert.equal(dyad.linuxParameters.sharedMemorySize, 1024);
  assert.equal(
    dyad.environment.find((item) => item.name === "GAS_CITY_HOST_BRIDGE_HOST")
      .value,
    "0.0.0.0",
  );
  assert.equal(task.networkMode, "host");
  assert.equal(dyad.portMappings, undefined);
  assert.equal(
    gascity.environment.find((item) => item.name === "WEAVER_BASE_URL").value,
    "http://dyad:32100",
  );
  assert.deepEqual(gascity.extraHosts, [
    { hostname: "dyad", ipAddress: "127.0.0.1" },
  ]);
  assert.equal(JSON.stringify(task).includes("8787"), false);
  assert.equal(JSON.stringify(task).includes("sleep"), false);
  assert.deepEqual(
    task.volumes.map((item) => item.name),
    ["canary-user-data", "canary-projects"],
  );
});

test("the canary service runs one task and does not open the bridge", () => {
  const service = canaryService({
    taskDefinition: "wewebplus-canary:1",
  });
  assert.equal(service.desiredCount, 1);
  assert.equal(service.deploymentConfiguration.maximumPercent, 100);
  assert.equal(service.networkConfiguration, undefined);
  assert.equal(service.serviceConnectConfiguration, undefined);
  assert.doesNotThrow(() => assertPrivateBridge([]));
  assert.throws(
    () => assertPrivateBridge([{ cidr: "0.0.0.0/0", port: 32100 }]),
    /32100/,
  );
});

test("an image from another region is refused", () => {
  assert.throws(
    () =>
      canaryTaskDefinition({
        ...images,
        dyadImage:
          "123456789012.dkr.ecr.us-east-1.amazonaws.com/wewebplus-dyad:canary",
      }),
    /ap-southeast-1/,
  );
});

test("plaintext database URLs are refused", () => {
  assert.throws(
    () =>
      canaryTaskDefinition({
        ...images,
        secrets: [
          {
            name: "WEWEBPLUS_DATABASE_URL",
            value: "postgres://example",
          },
        ],
      }),
    /references/,
  );
});
