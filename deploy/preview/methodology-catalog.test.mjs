import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEFAULT_METHODOLOGY,
  nextStepId,
  resolveMethodology,
  stepPrompt,
  toolDecision,
} from "./methodology-catalog.mjs";
import { orgRunSource, patchCodingAgent, patchThink, patchThinkAgent } from "./vibesdk-org-run.mjs";

test("the default pack is speckit-phased and unresolved packs are refused", () => {
  const speckit = resolveMethodology(undefined);
  assert.equal(speckit.ok, true);
  assert.equal(speckit.record.id, DEFAULT_METHODOLOGY);
  assert.equal(speckit.record.steps[0].artifacts[0], "spec.md");

  const gsd = resolveMethodology("gsd-build");
  assert.equal(gsd.ok, true);
  assert.equal(gsd.record.steps[0].artifacts[0], ".planning/PROJECT.md");

  const openspec = resolveMethodology("openspec-phased");
  assert.equal(openspec.ok, true);
  assert.equal(openspec.record.steps[0].artifacts[0], "proposal.md");

  for (const id of ["superpowers-phased", "bmad-phased", "gstack-phased", "compound-phased", "build-basic-phased"]) {
    const refused = resolveMethodology(id);
    assert.equal(refused.ok, false, id);
    assert.match(refused.message, /not imported/);
  }
  const unknown = resolveMethodology("not-a-pack");
  assert.equal(unknown.ok, false);
  assert.match(unknown.message, /Unknown methodology pack/);
});

test("a stored pack changes the step text and the file gate", () => {
  const speckit = resolveMethodology("speckit-phased").record;
  const gsd = resolveMethodology("gsd-build").record;
  assert.match(stepPrompt(speckit, "requirements"), /spec\.md/);
  assert.match(stepPrompt(gsd, "requirements"), /\.planning\/PROJECT\.md/);
  assert.equal(toolDecision(speckit, "requirements", "write", { path: "spec.md" }).allow, true);
  assert.equal(toolDecision(speckit, "requirements", "write", { path: "src/App.tsx" }).allow, false);
  assert.equal(toolDecision(speckit, "requirements", "deploy_space", {}).allow, false);
  assert.equal(toolDecision(speckit, "implement", "deploy_space", {}).allow, true);
  assert.equal(toolDecision(gsd, "requirements", "write", { path: ".planning/PROJECT.md" }).allow, true);
  assert.equal(nextStepId(speckit, "requirements", "turn"), "clarify");
  assert.equal(nextStepId(speckit, "implement", "turn"), "implement");
  assert.equal(nextStepId(speckit, "implement", "deploy"), "review");
  assert.equal(nextStepId(gsd, "verify-work", "answer"), "approve-ship");
});

test("the builder prompt receives the current step and does not contain a pack procedure", async () => {
  const source = await readFile("/tmp/vibesdk-full/worker/agents/core/behaviors/think.ts", "utf8");
  const agent = await readFile("/tmp/vibesdk-full/worker/agents/think/ThinkAgent.ts", "utf8");
  const patched = patchThink(source);
  const tools = patchThinkAgent(agent);
  assert.match(patched, /methodologyStepPrompt\(this\.env, this\.getAgentId\(\)\)/);
  assert.match(patched, /advanceMethodology\(this\.env, this\.getAgentId\(\), 'turn'\)/);
  assert.equal(patched.includes("NEEDS CLARIFICATION"), false);
  assert.equal(patched.includes("superpowers-development"), false);
  assert.equal(patched.includes("bmad-story"), false);
  assert.match(tools, /guardMethodologyTool\('write'/);
  assert.match(tools, /guardMethodologyTool\('deploy_space'/);
  const coding = patchCodingAgent(
    [
      'import { AppService, ModelConfigService } from "worker/database";',
      "        this.logger().info(`Agent connected for agent ${this.getAgentId()}`, { connection, ctx });",
      "            updatedAt: new Date()",
      "            });",
      "        this.logger().info(`App saved successfully to database for agent ${this.state.metadata.agentId}`, {",
      "        await this.saveToDatabase();",
      "        ",
      "        return this.state;",
    ].join("\n"),
  );
  assert.ok(coding.indexOf("assertRunnableMethodology(this.env)") < coding.indexOf("await this.saveToDatabase();"));
  const run = orgRunSource();
  assert.match(run, /methodology_step/);
  assert.equal(run.includes("phase"), false);
});
