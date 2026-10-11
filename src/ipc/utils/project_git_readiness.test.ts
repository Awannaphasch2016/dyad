import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DyadErrorKind } from "@/errors/dyad_error";

const getCurrentCommitHash = vi.hoisted(() => vi.fn(async () => "abc123"));

vi.mock("./git_utils", () => ({
  getCurrentCommitHash,
}));

import { readProjectCommitHash } from "./project_git_readiness";

describe("readProjectCommitHash", () => {
  it("does not call Git when the project folder is missing", async () => {
    getCurrentCommitHash.mockClear();
    const missing = path.join(
      os.tmpdir(),
      `dyad-missing-project-${process.pid}`,
    );
    fs.rmSync(missing, { recursive: true, force: true });

    await expect(readProjectCommitHash(missing)).rejects.toMatchObject({
      message: "This project's files are missing.",
      kind: DyadErrorKind.NotFound,
    });
    expect(getCurrentCommitHash).not.toHaveBeenCalled();
  });

  it("does not call Git when the folder is not a repository", async () => {
    getCurrentCommitHash.mockClear();
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-not-repo-"));

    await expect(readProjectCommitHash(folder)).rejects.toMatchObject({
      message: "This project is not ready.",
      kind: DyadErrorKind.Precondition,
    });
    expect(getCurrentCommitHash).not.toHaveBeenCalled();
    fs.rmSync(folder, { recursive: true, force: true });
  });

  it("reads the commit hash when the folder is a Git repo", async () => {
    getCurrentCommitHash.mockClear();
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-repo-"));
    fs.mkdirSync(path.join(folder, ".git"));

    await expect(readProjectCommitHash(folder)).resolves.toBe("abc123");
    expect(getCurrentCommitHash).toHaveBeenCalledWith({ path: folder });
    fs.rmSync(folder, { recursive: true, force: true });
  });
});
