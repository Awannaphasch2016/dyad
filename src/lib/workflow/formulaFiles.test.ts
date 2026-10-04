import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { exampleReviewPipeline } from "./formulaGraph";
import {
  formulaFilePath,
  layoutFilePath,
  readStoredFormula,
  saveStoredFormula,
  saveStoredLayout,
  unlinkedStoredFormula,
} from "./formulaFiles";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function tempProject(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "formula-graph-"));
  directories.push(dir);
  return dir;
}

describe("formula files", () => {
  it("writes the formula only after compile succeeds", async () => {
    const projectDir = await tempProject();
    const graph = exampleReviewPipeline();
    await saveStoredFormula(
      projectDir,
      graph,
      { draft: { x: 1, y: 2 } },
      async () => {},
    );
    const stored = await readStoredFormula(projectDir, graph.formulaName);
    expect(stored.persisted).toBe(true);
    expect(stored.linked).toBe(true);
    expect(stored.graph.nodes).toHaveLength(4);
    expect(stored.positions.draft).toEqual({ x: 1, y: 2 });
    expect(
      await readFile(layoutFilePath(projectDir, graph.formulaName), "utf8"),
    ).toContain('"x": 1');
  });

  it("restores the previous formula when compile fails", async () => {
    const projectDir = await tempProject();
    const graph = exampleReviewPipeline();
    await saveStoredFormula(projectDir, graph, {}, async () => {});
    const original = await readFile(
      formulaFilePath(projectDir, graph.formulaName),
      "utf8",
    );
    const broken = {
      ...graph,
      description: "should not stick",
    };
    await expect(
      saveStoredFormula(
        projectDir,
        broken,
        { draft: { x: 9, y: 9 } },
        async () => {
          throw new Error("v2 formula contains a cycle");
        },
      ),
    ).rejects.toThrow(/cycle/);
    expect(
      await readFile(formulaFilePath(projectDir, graph.formulaName), "utf8"),
    ).toBe(original);
    await expect(
      readFile(layoutFilePath(projectDir, graph.formulaName), "utf8"),
    ).resolves.not.toContain('"x": 9');
  });

  it("deletes a new formula when the first compile fails", async () => {
    const projectDir = await tempProject();
    const graph = exampleReviewPipeline();
    await expect(
      saveStoredFormula(
        projectDir,
        graph,
        { draft: { x: 9, y: 9 } },
        async () => {
          throw new Error("not a city");
        },
      ),
    ).rejects.toThrow(/not a city/);
    await expect(
      readFile(formulaFilePath(projectDir, graph.formulaName), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(layoutFilePath(projectDir, graph.formulaName), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("saves a drag without rewriting the formula", async () => {
    const projectDir = await tempProject();
    const graph = exampleReviewPipeline();
    await saveStoredFormula(projectDir, graph, {}, async () => {});
    const before = await readFile(
      formulaFilePath(projectDir, graph.formulaName),
      "utf8",
    );
    await saveStoredLayout(projectDir, graph.formulaName, {
      draft: { x: 40, y: 50 },
    });
    expect(
      await readFile(formulaFilePath(projectDir, graph.formulaName), "utf8"),
    ).toBe(before);
    const stored = await readStoredFormula(projectDir, graph.formulaName);
    expect(stored.positions.draft).toEqual({ x: 40, y: 50 });
  });

  it("shows the review pipeline in memory when the app is not linked", () => {
    const stored = unlinkedStoredFormula("review-pipeline");
    expect(stored.linked).toBe(false);
    expect(stored.persisted).toBe(false);
    expect(stored.run).toBeNull();
    expect(stored.graph.nodes.map((node) => node.id)).toEqual([
      "draft",
      "revise",
      "approve",
      "ship",
    ]);
    expect(stored.positions.draft).toEqual(
      expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
    );
  });
});
