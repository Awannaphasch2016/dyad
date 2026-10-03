import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  it("creates a git repository when the app folder does not exist", async () => {
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
    ).resolves.toBe(true);

    expect((await fs.stat(path.join(appPath, ".git"))).isDirectory()).toBe(
      true,
    );
    expect(await commitCount(appPath)).toBe(1);
  });

  it("adds a git repository to an existing folder that has no .git", async () => {
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
    ).resolves.toBe(true);

    expect(await commitCount(appPath)).toBe(1);
    const { stdout } = await execFileAsync(
      "git",
      ["ls-files", "pnpm-workspace.yaml"],
      { cwd: appPath },
    );
    expect(stdout.trim()).toBe("pnpm-workspace.yaml");
  });

  it("leaves an existing repository on its current commit", async () => {
    const appPath = await tempDir();
    await execFileAsync("git", ["init", "-b", "main"], { cwd: appPath });
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
