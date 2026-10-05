import fs from "node:fs";
import path from "node:path";
import log from "electron-log";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apps } from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { gitClone, gitPush, gitSetRemoteUrl } from "@/ipc/utils/git_utils";
import { getDyadAppPath } from "@/paths/paths";
import { getControlPlaneDb } from "./db";
import type { AccountOwner } from "./owner";
import { readAccountConnection } from "./repository";
import { decryptSecret } from "./secrets";

const logger = log.scope("account_file_sync");

export async function githubTokenFor(
  owner: AccountOwner,
): Promise<string | null> {
  const plane = await getControlPlaneDb();
  if (!plane) return null;
  const row = await readAccountConnection(plane, owner, "github");
  if (!row) return null;
  return decryptSecret(row.ciphertext);
}

export function assertPackageJsonPresent(appPath: string): void {
  if (fs.existsSync(path.join(appPath, "package.json"))) return;
  throw new DyadError(
    "This app has no package.json.",
    DyadErrorKind.Precondition,
  );
}

export async function ensureProjectFiles(app: {
  path: string;
  githubOrg: string | null;
  githubRepo: string | null;
  ownerType: "user" | "org" | null;
  ownerId: string | null;
}): Promise<boolean> {
  const appPath = getDyadAppPath(app.path);
  if (fs.existsSync(path.join(appPath, ".git"))) {
    assertPackageJsonPresent(appPath);
    return true;
  }
  if (
    !fs.existsSync(appPath) &&
    app.githubOrg &&
    app.githubRepo &&
    app.ownerType &&
    app.ownerId
  ) {
    const token = await githubTokenFor({
      type: app.ownerType,
      id: app.ownerId,
    });
    if (!token) return false;
    await gitClone({
      path: appPath,
      url: `https://github.com/${app.githubOrg}/${app.githubRepo}.git`,
      accessToken: token,
      singleBranch: false,
    });
    assertPackageJsonPresent(appPath);
    return true;
  }
  if (!fs.existsSync(appPath)) {
    throw new DyadError(
      "The project files are missing.",
      DyadErrorKind.Precondition,
    );
  }
  assertPackageJsonPresent(appPath);
  return true;
}

/** Best-effort push after a local commit when the account has a GitHub token. */
export async function pushAppAfterCommit(appPath: string): Promise<void> {
  if (!process.env.WEWEBPLUS_DATABASE_URL) return;
  const rows = db.select().from(apps).all();
  const app = rows.find((row) => {
    try {
      return getDyadAppPath(row.path) === appPath || row.path === appPath;
    } catch {
      return false;
    }
  });
  if (!app?.githubOrg || !app.githubRepo || !app.ownerType || !app.ownerId) {
    return;
  }
  const token = await githubTokenFor({
    type: app.ownerType,
    id: app.ownerId,
  });
  if (!token) return;
  const remoteUrl = `https://github.com/${app.githubOrg}/${app.githubRepo}.git`;
  try {
    await gitSetRemoteUrl({ path: appPath, remoteUrl });
    await gitPush({
      path: appPath,
      branch: app.githubBranch || "main",
      accessToken: token,
    });
  } catch (error) {
    logger.warn("Account git push skipped", error);
  }
}

export async function appById(appId: number) {
  return db.select().from(apps).where(eq(apps.id, appId)).get();
}
