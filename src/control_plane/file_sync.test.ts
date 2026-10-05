import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DyadErrorKind } from "@/errors/dyad_error";
import { ensureProjectFiles } from "./file_sync";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

vi.mock("@/ipc/utils/git_utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/ipc/utils/git_utils")>();
  return {
    ...actual,
    gitClone: vi.fn(async ({ path: repoPath }: { path: string }) => {
      await fs.mkdir(repoPath, { recursive: true });
      await fs.mkdir(path.join(repoPath, ".git"));
    }),
  };
});

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ensure-project-files-"));
  tempDirs.push(dir);
  return dir;
}

async function commitCount(repoPath: string): Promise<number> {
  const { stdout } = await execFileAsync(
    "git",
    ["rev-list", "--count", "HEAD"],
    { cwd: repoPath },
  );
  return Number(stdout.trim());
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("ensureProjectFiles", () => {
  it("throws when the app folder does not exist and there is nothing to clone", async () => {
    const parent = await tempDir();
    const appPath = path.join(parent, "new-app");

    await expect(
      ensureProjectFiles({
        path: appPath,
        githubOrg: null,
        githubRepo: null,
        ownerType: "org",
        ownerId: "org_test",
      }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Precondition,
      message: "The project files are missing.",
    });

    await expect(fs.stat(appPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("throws when the folder has no package.json and does not create a git repo", async () => {
    const appPath = await tempDir();
    await fs.writeFile(
      path.join(appPath, "pnpm-workspace.yaml"),
      "packages: []\n",
    );

    await expect(
      ensureProjectFiles({
        path: appPath,
        githubOrg: null,
        githubRepo: null,
        ownerType: null,
        ownerId: null,
      }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Precondition,
      message: "This app has no package.json.",
    });

    await expect(fs.stat(path.join(appPath, ".git"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("throws when a git repository has no package.json", async () => {
    const appPath = await tempDir();
    await execFileAsync("git", ["init", "-b", "main"], { cwd: appPath });

    await expect(
      ensureProjectFiles({
        path: appPath,
        githubOrg: null,
        githubRepo: null,
        ownerType: null,
        ownerId: null,
      }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Precondition,
      message: "This app has no package.json.",
    });
  });

  it("leaves an existing repository on its current commit", async () => {
    const appPath = await tempDir();
    await execFileAsync("git", ["init", "-b", "main"], { cwd: appPath });
    await fs.writeFile(path.join(appPath, "package.json"), "{}\n");
    await fs.writeFile(path.join(appPath, "keep.txt"), "keep\n");
    await execFileAsync("git", ["add", "keep.txt"], { cwd: appPath });
    await execFileAsync(
      "git",
      [
        "-c",
        "user.name=Dyad",
        "-c",
        "user.email=git@dyad.sh",
        "commit",
        "-m",
        "existing",
      ],
      { cwd: appPath },
    );

    await ensureProjectFiles({
      path: appPath,
      githubOrg: null,
      githubRepo: null,
      ownerType: null,
      ownerId: null,
    });

    expect(await commitCount(appPath)).toBe(1);
    const { stdout } = await execFileAsync(
      "git",
      ["log", "-1", "--format=%s"],
      { cwd: appPath },
    );
    expect(stdout.trim()).toBe("existing");
  });
});
