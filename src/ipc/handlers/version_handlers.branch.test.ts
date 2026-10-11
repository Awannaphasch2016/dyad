import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { apps } from "@/db/schema";
import {
  type HandlerTestHarness,
  setupHandlerTestHarness,
} from "@/testing/handler_test_harness";
import { registerVersionHandlers } from "./version_handlers";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "branch-ready-"));
  tempDirs.push(dir);
  return dir;
}

describe("getCurrentBranch project readiness", () => {
  let harness: HandlerTestHarness;

  beforeAll(() => {
    registerVersionHandlers();
  });

  beforeEach(() => {
    harness = setupHandlerTestHarness();
  });

  afterEach(async () => {
    harness.dispose();
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  async function seedApp(appPath: string): Promise<number> {
    return Number(
      harness.db
        .insert(apps)
        .values({ name: "ready-check", path: appPath })
        .run().lastInsertRowid,
    );
  }

  it("returns not ready when the folder has no git repository", async () => {
    const appPath = await tempDir();
    await fs.writeFile(path.join(appPath, "package.json"), "{}\n");
    const appId = await seedApp(appPath);

    await expect(
      harness.invokeHandler("get-current-branch", { appId }),
    ).resolves.toEqual({ projectReady: false, branch: null });
  });

  it("returns not ready when package.json is missing", async () => {
    const appPath = await tempDir();
    await execFileAsync("git", ["init", "-b", "main"], { cwd: appPath });
    const appId = await seedApp(appPath);

    await expect(
      harness.invokeHandler("get-current-branch", { appId }),
    ).resolves.toEqual({ projectReady: false, branch: null });
  });

  it("returns the branch when the folder is a finished project", async () => {
    const appPath = await tempDir();
    await execFileAsync("git", ["init", "-b", "main"], { cwd: appPath });
    await fs.writeFile(path.join(appPath, "package.json"), "{}\n");
    await execFileAsync("git", ["add", "package.json"], { cwd: appPath });
    await execFileAsync(
      "git",
      [
        "-c",
        "user.name=Dyad",
        "-c",
        "user.email=git@dyad.sh",
        "commit",
        "-m",
        "init",
      ],
      { cwd: appPath },
    );
    const appId = await seedApp(appPath);

    await expect(
      harness.invokeHandler("get-current-branch", { appId }),
    ).resolves.toEqual({ projectReady: true, branch: "main" });
  });
});
