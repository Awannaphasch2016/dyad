import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const formulasRoot = path.resolve(process.cwd(), "formulas");

interface StepNode {
  id: string;
  needs: string[];
  condition: string;
  drainFormula: string;
  expand: string;
  children: string[];
}

function read(rel: string): string {
  return readFileSync(path.join(formulasRoot, rel), "utf8");
}

function parseSteps(toml: string): Map<string, StepNode> {
  const steps = new Map<string, StepNode>();
  let current: StepNode | null = null;
  let parent: StepNode | null = null;
  let inDrain = false;

  const ensure = (): StepNode => {
    if (!current) {
      throw new Error("step field appeared before a step id");
    }
    return current;
  };

  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "[[steps]]") {
      current = {
        id: "",
        needs: [],
        condition: "",
        drainFormula: "",
        expand: "",
        children: [],
      };
      parent = current;
      inDrain = false;
      continue;
    }
    if (line === "[[steps.children]]") {
      if (!parent) throw new Error("child step without a parent");
      current = {
        id: "",
        needs: [],
        condition: "",
        drainFormula: "",
        expand: "",
        children: [],
      };
      inDrain = false;
      continue;
    }
    if (line.startsWith("[steps.drain")) {
      inDrain = true;
      continue;
    }
    if (line.startsWith("[") && !line.startsWith("[steps.drain")) {
      inDrain = false;
    }
    const id = line.match(/^id = "([^"]+)"$/);
    if (id && current && current.id === "") {
      current.id = id[1];
      if (current === parent) steps.set(current.id, current);
      else parent?.children.push(current.id);
      continue;
    }
    const needs = line.match(/^needs = \[(.*)\]$/);
    if (needs && current) {
      ensure().needs = [...needs[1].matchAll(/"([^"]+)"/g)].map(
        (match) => match[1],
      );
      continue;
    }
    const condition = line.match(/^condition = "(.+)"$/);
    if (condition && current) {
      ensure().condition = condition[1];
      continue;
    }
    const expand = line.match(/^expand = "([^"]+)"$/);
    if (expand && current) {
      ensure().expand = expand[1];
      continue;
    }
    const drainFormula = line.match(/^formula = "([^"]+)"$/);
    if (drainFormula && inDrain && current) {
      ensure().drainFormula = drainFormula[1];
    }
  }
  return steps;
}

function formula(rel: string): Map<string, StepNode> {
  return parseSteps(read(rel));
}

function expectNeeds(
  steps: Map<string, StepNode>,
  id: string,
  needs: string[],
) {
  expect(steps.get(id)?.needs, id).toEqual(needs);
}

const column3 = [
  "openspec/formulas/openspec-phased.formula.toml",
  "speckit/formulas/speckit-phased.formula.toml",
  "bmad-hitl/formulas/bmad-phased.formula.toml",
  "superpowers-hitl/formulas/superpowers-phased.formula.toml",
  "gstack-hitl/formulas/gstack-phased.formula.toml",
  "compound-hitl/formulas/compound-phased.formula.toml",
  "build-basic-hitl/formulas/build-basic-phased.formula.toml",
];

describe("methodology pack graphs", () => {
  it("keeps organization roles out of column 2 and column 3", () => {
    const files = readdirSync(formulasRoot, { recursive: true }).flatMap(
      (entry) => {
        const rel = String(entry);
        if (
          !rel.endsWith(".formula.toml") &&
          !rel.endsWith(".md") &&
          !rel.endsWith(".sh")
        ) {
          return [];
        }
        if (rel.startsWith("gsd/") || rel.startsWith("gsd\\")) return [];
        return [rel];
      },
    );
    expect(files.length).toBeGreaterThan(10);
    for (const rel of files) {
      const text = read(rel);
      expect(text, rel).not.toContain("gc.hitl.role");
      expect(text, rel).not.toContain("project-manager");
      expect(text, rel).not.toContain("[steps.gate]");
    }
  });

  it("runs OpenSpec specs and design in parallel, then pauses before apply", () => {
    const steps = formula("openspec/formulas/openspec-build.formula.toml");
    expectNeeds(steps, "specs", ["requirements"]);
    expectNeeds(steps, "plan", ["requirements"]);
    expectNeeds(steps, "decompose", ["specs", "plan"]);
    expectNeeds(steps, "accept-apply", ["scenario-validate"]);
    expectNeeds(steps, "implement", ["accept-apply"]);
    expect(steps.get("implement")?.drainFormula).toBe("do-work");
    expectNeeds(steps, "archive", ["finalize"]);
    expectNeeds(steps, "publish", ["archive"]);
    expect(steps.get("accept-apply")?.children).toEqual([
      "revise-apply",
      "confirm-apply",
    ]);
    expect(read("openspec/formulas/openspec-build.formula.toml")).not.toContain(
      "specify workflow",
    );
  });

  it("runs Spec Kit commands without the workflow engine", () => {
    const text = read("speckit/formulas/speckit-build.formula.toml");
    const steps = parseSteps(text);
    expect(text).toContain("does not run specify workflow");
    expect(steps.has("clarify")).toBe(true);
    expect(steps.has("approve-implementation")).toBe(false);
    expect(steps.has("review-spec")).toBe(false);
    expectNeeds(steps, "plan", ["clarify"]);
    expectNeeds(steps, "decompose", ["plan"]);
    expectNeeds(steps, "implement", ["decompose"]);
    expect(steps.get("implement")?.drainFormula).toBe("do-work");
    expectNeeds(steps, "finalize", ["review"]);
  });

  it("places three human gates on every phased formula", () => {
    for (const rel of column3) {
      const steps = formula(rel);
      for (const id of [
        "accept-discovery",
        "accept-implementation",
        "accept-delivery",
      ]) {
        expect(steps.has(id), `${rel} ${id}`).toBe(true);
        expect(steps.get(id)?.children, `${rel} ${id}`).toEqual([
          `revise-${id.replace("accept-", "")}`,
          `confirm-${id.replace("accept-", "")}`,
        ]);
      }
      expectNeeds(steps, "accept-implementation", ["review"]);
      expectNeeds(steps, "accept-delivery", ["finalize"]);
      expect(steps.get("implement")?.needs, rel).toEqual(["accept-discovery"]);
      expect(steps.get("implement")?.condition).toBe(
        "{{drain_policy}} == separate",
      );
    }
  });

  it("keeps each methodology drain and the phase cuts", () => {
    const bmad = formula("bmad-hitl/formulas/bmad-phased.formula.toml");
    expectNeeds(bmad, "accept-discovery", ["implementation-readiness"]);
    expect(bmad.get("implement")?.drainFormula).toBe("bmad-story-development");
    expectNeeds(bmad, "finalize", ["accept-implementation"]);
    expectNeeds(bmad, "publish", ["accept-delivery"]);

    const superpowers = formula(
      "superpowers-hitl/formulas/superpowers-phased.formula.toml",
    );
    expectNeeds(superpowers, "accept-discovery", ["decompose"]);
    expect(superpowers.get("implement")?.drainFormula).toBe(
      "superpowers-development",
    );

    const gstack = formula("gstack-hitl/formulas/gstack-phased.formula.toml");
    expect(gstack.get("implement")?.drainFormula).toBe("gstack-work");
    expectNeeds(gstack, "qa", ["accept-implementation"]);
    expect(gstack.get("qa")?.expand).toBe("gstack-qa-review");
    expectNeeds(gstack, "publish", ["accept-delivery"]);
    expect(gstack.has("finalize")).toBe(false);

    const compound = formula(
      "compound-hitl/formulas/compound-phased.formula.toml",
    );
    expect(compound.get("implement")?.drainFormula).toBe("compound-work");
    expect(compound.get("finalize")?.expand).toBe("compound-resolution");
    expectNeeds(compound, "finalize", ["accept-implementation"]);

    const basic = formula(
      "build-basic-hitl/formulas/build-basic-phased.formula.toml",
    );
    expect(basic.get("implement")?.drainFormula).toBe("do-work");
    expectNeeds(basic, "accept-discovery", ["decompose"]);

    const openspec = formula("openspec/formulas/openspec-phased.formula.toml");
    expect(openspec.get("accept-apply")?.condition).toBe(
      "{{keep_native_apply_gate}}",
    );
    expectNeeds(openspec, "accept-discovery", ["scenario-validate"]);
    expectNeeds(openspec, "archive", ["accept-delivery"]);

    const speckit = formula("speckit/formulas/speckit-phased.formula.toml");
    expectNeeds(speckit, "accept-discovery", ["decompose"]);
    expectNeeds(speckit, "publish", ["accept-delivery"]);
    expect(read("speckit/formulas/speckit-phased.formula.toml")).toContain(
      "does not run specify workflow",
    );
  });

  it("uses one human-gate verdict script and one mail prompt", () => {
    const script = read(
      "human-gate/assets/scripts/checks/human-gate-verdict.sh",
    );
    const prompt = read("human-gate/assets/workflows/confirm-human-gate.md");
    expect(script).toContain("approve|approved|done|pass)");
    expect(script).toContain("request-changes|iterate|fail|retry|");
    expect(prompt).toContain("gc mail send human");
    expect(prompt).toContain("Do not pass `--notify`.");
    for (const dir of [
      "openspec",
      "speckit",
      "bmad-hitl",
      "superpowers-hitl",
      "gstack-hitl",
      "compound-hitl",
      "build-basic-hitl",
    ]) {
      expect(read(`${dir}/assets/scripts/checks/human-gate-verdict.sh`)).toBe(
        script,
      );
      expect(read(`${dir}/assets/workflows/confirm-human-gate.md`)).toBe(
        prompt,
      );
    }
  });
});
