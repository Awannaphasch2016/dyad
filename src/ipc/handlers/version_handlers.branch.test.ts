import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { apps } from "@/db/schema";
import {
  type HandlerTestHarness,
  setupHandlerTestHarness,
} from "@/testing/handler_test_harness";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  app: {
    getPath: vi.fn(() => path.join(os.tmpdir(), "dyad-branch-user-data")),
    getAppPath: vi.fn(() => process.cwd()),
  },
}));

const { registerVersionHandlers } = await import("./version_handlers");

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "branch-ready-"));
  tempDirs.push(dir);
  return dir;
}

describe("getCurrentBranch project files", () => {
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

  it("creates main when the app folder has no git repository", async () => {
    const parent = await tempDir();
    const appPath = path.join(parent, "missing-repo");
    await fs.mkdir(appPath);
    await fs.writeFile(path.join(appPath, "package.json"), "{}\n");
    const appId = await seedApp(appPath);

    await expect(
      harness.invokeHandler("get-current-branch", { appId }),
    ).resolves.toEqual({ branch: "main" });

    const { stdout } = await execFileAsync(
      "git",
      ["rev-list", "--count", "HEAD"],
      {
        cwd: appPath,
      },
    );
    expect(stdout.trim()).toBe("1");
  });

  it("returns main for an existing repository without a new commit", async () => {
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
    const appId = await seedApp(appPath);

    await expect(
      harness.invokeHandler("get-current-branch", { appId }),
    ).resolves.toEqual({ branch: "main" });

    const { stdout } = await execFileAsync(
      "git",
      ["log", "-1", "--format=%s"],
      {
        cwd: appPath,
      },
    );
    expect(stdout.trim()).toBe("existing");
  });
});
