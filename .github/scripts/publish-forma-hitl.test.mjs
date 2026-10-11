import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertSafePatch,
  formaMergeBody,
  FORMA_BRANCH,
  FORMA_REPOSITORY,
} from "./publish-forma-hitl.mjs";

const patch = readFileSync(
  new URL("../../deploy/forma/agent-hitl.patch", import.meta.url),
  "utf8",
);

test("the checked-in Forma patch is the role pause and has no fixture cookie", () => {
  assertSafePatch(patch);
  assert.match(patch, /lib\/hitl\.ts/);
  assert.match(patch, /lib\/request-marker\.ts/);
  assert.doesNotMatch(patch, /FORMA_HITL_FIXTURE/);
  assert.doesNotMatch(patch, /forma_fixture/);
});

test("assertSafePatch rejects production markers", () => {
  assert.throws(
    () => assertSafePatch("endpoint ep-young-wave"),
    /ep-young-wave/,
  );
});

test("formaMergeBody accepts only the HITL branch into forma main", () => {
  assert.deepEqual(
    formaMergeBody({
      base: { ref: "main", repo: { full_name: FORMA_REPOSITORY } },
      head: { ref: FORMA_BRANCH },
    }),
    {
      commit_title:
        "Pause a Forma turn for one role and resume the same session.",
      merge_method: "squash",
    },
  );
  assert.throws(
    () =>
      formaMergeBody({
        base: { ref: "main", repo: { full_name: FORMA_REPOSITORY } },
        head: { ref: "cursor/forma-container-5014" },
      }),
    /cursor\/forma-container-5014/,
  );
  assert.throws(
    () =>
      formaMergeBody({
        base: {
          ref: "cursor/forma-preview-walkthrough",
          repo: { full_name: FORMA_REPOSITORY },
        },
        head: { ref: FORMA_BRANCH },
      }),
    /forma-preview-walkthrough/,
  );
  assert.throws(
    () =>
      formaMergeBody({
        base: { ref: "main", repo: { full_name: "Awannaphasch2016/dyad" } },
        head: { ref: FORMA_BRANCH },
      }),
    /dyad/,
  );
});
