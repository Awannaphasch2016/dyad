import assert from "node:assert/strict";
import test from "node:test";
import { runtimeStatusLine } from "./runtime_status.ts";

test("an open preview question is stored and not a running agent", () => {
  assert.equal(
    runtimeStatusLine({
      status: "open",
      runtimeRunId: null,
      preview: true,
    }),
    "Question stored.",
  );
});

test("an answered preview question waits until the runtime id exists", () => {
  assert.equal(
    runtimeStatusLine({
      status: "answered",
      runtimeRunId: null,
      preview: true,
    }),
    "Waiting for the runtime.",
  );
  assert.equal(
    runtimeStatusLine({
      status: "answered",
      runtimeRunId: "gas-city-run:abc",
      preview: true,
    }),
    "Run accepted. gas-city-run:abc",
  );
});

test("a refused post is not a successful run", () => {
  assert.equal(
    runtimeStatusLine({
      status: "answered",
      runtimeRunId: "refused",
      preview: true,
    }),
    "The runtime refused the run.",
  );
});

test("production does not show the preview wait line", () => {
  assert.equal(
    runtimeStatusLine({
      status: "answered",
      runtimeRunId: null,
      preview: false,
    }),
    null,
  );
});
