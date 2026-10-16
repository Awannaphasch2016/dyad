// Locks the 27 legacy operations at catalog base a9c0b411.
// These tests call parseArgs and resolve only. They do not start a workflow.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OPERATIONS } from "../lib/catalog.js";
import { HELP, checkVerify, parseArgs, resolve } from "../lib/cli.js";
import { parseWorkflowOn } from "./workflow_file.mjs";

const root = new URL("../../../", import.meta.url);
const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/baseline-contract.json", import.meta.url),
    "utf8",
  ),
);

function fieldKeys(fields) {
  return fields.map((field) => field.split("=", 1)[0]);
}

function withoutFlags(argv, names) {
  const stripped = [];
  let index = 0;
  while (index < argv.length) {
    if (names.includes(argv[index])) {
      index += 2;
      continue;
    }
    stripped.push(argv[index]);
    index += 1;
  }
  return stripped;
}

function serializedVerify(verify) {
  return (verify || []).map((item) =>
    item.expect instanceof RegExp
      ? { key: item.key, regex: item.expect.source }
      : { key: item.key, equals: item.expect },
  );
}

function reviveVerify(verify) {
  return verify.map((item) => ({
    key: item.key,
    expect: item.regex ? new RegExp(item.regex) : item.equals,
  }));
}

test("the catalog still has the 27 legacy operations and the old grammar", () => {
  assert.equal(fixture.catalogBase, "a9c0b41122a252aa0d389e456cd21f91258586c3");
  assert.equal(fixture.operationCount, 27);
  assert.equal(Object.keys(OPERATIONS).length, 27);
  assert.deepEqual(
    fixture.operations.map((op) => op.name),
    Object.keys(OPERATIONS),
  );
  assert.equal(fixture.grammar, "ops-axi <operation> [positional] [flags]");
  assert.match(HELP, /^usage: ops-axi <operation> \[flags\]/);
  assert.match(HELP, /operations\[28\]:/);
  assert.equal(/\n  ui status /.test(HELP), false);
  assert.equal(/\n  session /.test(HELP), false);
  assert.equal(/\n  resource list /.test(HELP), false);
});

for (const op of fixture.operations) {
  test(`legacy contract: ${op.name}`, () => {
    const resolved = resolve(...Object.values(parseArgs(op.argv)));
    assert.equal(resolved.name, op.name);
    assert.equal(resolved.kind, op.kind);
    assert.equal(resolved.repo, op.repo);
    assert.equal(resolved.workflow ?? null, op.workflow);
    assert.equal(resolved.ref ?? null, op.ref);
    assert.deepEqual(resolved.fields, op.fields);
    assert.equal(resolved.project ?? null, op.project);
    assert.equal(resolved.config ?? null, op.config);
    assert.equal(resolved.digest ?? null, op.digest);
    assert.equal(resolved.pr ?? null, op.pr);
    assert.equal(resolved.labelAction ?? null, op.labelAction);
    const catalog = OPERATIONS[op.name];
    assert.equal(Boolean(catalog.writes), op.writes);
    assert.equal(Boolean(catalog.requiresDoppler), op.requiresDoppler);
    assert.equal(Boolean(catalog.needsTitle), op.needsTitle);
    assert.deepEqual(serializedVerify(resolved.verify), op.verify);

    if (op.positional) {
      const nameLength = op.name.split(" ").length;
      const broken = [
        ...op.argv.slice(0, nameLength),
        ...op.argv.slice(nameLength + 1),
      ];
      assert.throws(
        () => resolve(...Object.values(parseArgs(broken))),
        new RegExp(`needs <${op.positional.name}>`),
      );
    }
    if (op.requiresDoppler) {
      assert.throws(
        () =>
          resolve(
            ...Object.values(
              parseArgs(withoutFlags(op.argv, ["--project", "--config"])),
            ),
          ),
        /--project and --config/,
      );
    }
    if (op.needsTitle) {
      assert.throws(
        () =>
          resolve(
            ...Object.values(parseArgs(withoutFlags(op.argv, ["--title"]))),
          ),
        /--title/,
      );
    }

    if (!op.workflowPath) {
      assert.equal(op.kind, "toolbox-use");
      assert.equal(op.digest.startsWith("sha256:"), true);
      return;
    }

    const text = readFileSync(new URL(op.workflowPath, root), "utf8");
    const live = parseWorkflowOn(text);
    assert.deepEqual(live, op.checkout);
    assert.equal(live.permissions, true);

    const keys = fieldKeys(op.fields);
    if (op.kind === "dispatch") {
      for (const key of keys) {
        assert.equal(
          live.inputs.includes(key),
          true,
          `${op.name} sends ${key}, which this checkout's workflow does not declare`,
        );
      }
      for (const required of live.required) {
        assert.equal(
          keys.includes(required),
          true,
          `${op.name} omits required input ${required}`,
        );
      }
      assert.equal(live.triggers.includes("workflow_dispatch"), true);
    }
    if (op.kind === "label") {
      assert.equal(live.triggers.includes("pull_request"), true);
      assert.equal(live.types.includes("labeled"), true);
      assert.equal(live.types.includes("unlabeled"), true);
      assert.equal(live.triggers.includes("workflow_dispatch"), false);
      assert.equal(keys.includes("doppler-project"), false);
      assert.equal(op.pr, "177");
    }
    if (op.dispatchRef?.sameCheckout) {
      assert.deepEqual(op.dispatchRef.inputs, live.inputs);
      assert.deepEqual(
        keys.filter((key) => !live.inputs.includes(key)),
        op.undeclaredFields,
      );
    } else if (op.dispatchRef) {
      assert.equal(op.dispatchRef.sameCheckout, false);
      assert.deepEqual(
        keys.filter((key) => !op.dispatchRef.inputs.includes(key)),
        op.undeclaredFields,
      );
      assert.notDeepEqual(op.dispatchRef.inputs, live.inputs);
      assert.equal(op.undeclaredFields.length > 0, true);
    }
    if (op.workflowInCatalogRepo === false) {
      assert.match(text, /Copy it to/);
      assert.equal(op.repo, "Awannaphasch2016/forma");
      assert.equal(op.ref, "main");
    }
  });
}

test("verification rules still match the historical result lines", () => {
  const byName = Object.fromEntries(
    fixture.operations.map((op) => [op.name, op]),
  );
  const digest = `sha256:${"ab".repeat(32)}`;
  const cases = [
    ["formula verify", "AWS_PREVIEW_FORMULA_ROLE_ARN", "present", "absent"],
    ["formula deploy", "url", "http://formula.example", "missing-scheme"],
    ["doppler status", "doppler_oidc", "http-200", "http-401"],
    [
      "toolbox image",
      "image",
      `ghcr.io/awannaphasch2016/axi-toolbox@${digest}`,
      "ghcr.io/awannaphasch2016/axi-toolbox:latest",
    ],
  ];
  for (const [name, key, pass, fail] of cases) {
    const rule = reviveVerify(byName[name].verify);
    assert.deepEqual(checkVerify(rule, new Map([[key, pass]])), [], name);
    assert.equal(checkVerify(rule, new Map([[key, fail]])).length, 1, name);
    assert.deepEqual(checkVerify(rule, new Map()), [`${key} was not printed`]);
  }
});

for (const row of fixture.proposed) {
  test(`proposed command for ${row.legacy}`, () => {
    if (row.accepted) {
      const resolved = resolve(...Object.values(parseArgs(row.canonical)));
      assert.equal(resolved.name, row.legacy);
      return;
    }
    assert.throws(
      () => resolve(...Object.values(parseArgs(row.canonical))),
      /Unknown flag|Unknown operation/,
    );
    assert.ok(OPERATIONS[row.legacy], `${row.legacy} left the catalog`);
  });
}

for (const argv of fixture.notInCatalog) {
  test(`not in the catalog: ${argv.join(" ")}`, () => {
    assert.throws(
      () => resolve(...Object.values(parseArgs(argv))),
      /Unknown flag|Unknown operation/,
    );
  });
}

test("preview exec stays a fixed Devbox proof and formula deploy stays off SSH", () => {
  const exec = resolve(...Object.values(parseArgs(["preview", "exec"])));
  assert.equal(
    exec.fields.some((field) => field.startsWith("command=")),
    false,
  );
  assert.throws(
    () => parseArgs(["preview", "exec", "--command", "echo ok"]),
    /Unknown flag --command/,
  );
  const execFile = readFileSync(
    new URL(".github/workflows/preview-exec.yml", root),
    "utf8",
  );
  assert.match(execFile, /echo federated-ok/);
  assert.equal(parseWorkflowOn(execFile).inputs.includes("command"), false);

  const role = readFileSync(
    new URL(".github/workflows/preview-formula-role.yml", root),
    "utf8",
  );
  assert.match(role, /setup_formula_role\.py/);
  const deploy = readFileSync(
    new URL(".github/workflows/preview-formula.yml", root),
    "utf8",
  );
  assert.equal(deploy.includes("ssh"), false);
  assert.match(deploy, /formula_ecs/);
});

test("the contract fixture contains no credentials", () => {
  const text = readFileSync(
    new URL("./fixtures/baseline-contract.json", import.meta.url),
    "utf8",
  );
  assert.equal(
    /ghp_|github_pat_|gho_|AKIA[0-9A-Z]{16}|BEGIN (?:OPENSSH|RSA) PRIVATE|dp\.st\./.test(
      text,
    ),
    false,
  );
});
