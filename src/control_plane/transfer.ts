import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appKnowledgeItems, apps } from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getDyadAppPath } from "@/paths/paths";
import { slugifyAppFolderName } from "@/shared/app_names";
import {
  assertCan,
  destinationAllowed,
  organizationRoleForUser,
  resolveAccountSession,
} from "./access";
import { getControlPlaneDb } from "./db";
import type { AccountOwner } from "./owner";
import {
  insertControlApp,
  recordAudit,
  updateControlAppOwner,
} from "./repository";

async function assertDestination(
  event: { sender: { id: number } },
  destination: AccountOwner,
) {
  const session = await resolveAccountSession(event);
  if (session.mode === "unconfigured") return session;
  if (session.mode !== "signed-in") {
    throw new DyadError("Sign in to continue.", DyadErrorKind.Auth);
  }
  const destinationRole =
    destination.type === "org"
      ? await organizationRoleForUser(session.userId, destination.id)
      : null;
  if (
    !destinationAllowed({
      session,
      destination,
      destinationRole,
    })
  ) {
    throw new DyadError(
      "Only an admin of that account can put an app there.",
      DyadErrorKind.Auth,
    );
  }
  return session;
}

export async function moveAppToAccount(
  event: { sender: { id: number } },
  appId: number,
  destination: AccountOwner,
): Promise<void> {
  const app = db.select().from(apps).where(eq(apps.id, appId)).get();
  if (!app?.ownerType || !app.ownerId || !app.remoteId) {
    throw new DyadError(
      "This app is not in a shared account yet.",
      DyadErrorKind.Precondition,
    );
  }
  const session = await assertCan(event, "manage-members", {
    type: app.ownerType,
    id: app.ownerId,
  });
  await assertDestination(event, destination);
  const plane = await getControlPlaneDb();
  if (!plane) {
    throw new DyadError(
      "The shared database is not configured.",
      DyadErrorKind.Precondition,
    );
  }
  await updateControlAppOwner(plane, app.remoteId, destination);
  db.update(apps)
    .set({ ownerType: destination.type, ownerId: destination.id })
    .where(eq(apps.id, appId))
    .run();
  if (session.mode === "signed-in") {
    await recordAudit(plane, {
      id: randomUUID(),
      owner: destination,
      actorId: session.userId,
      action: "move-app",
      subject: app.remoteId,
    });
  }
}

export async function copyAppToAccount(
  event: { sender: { id: number } },
  appId: number,
  destination: AccountOwner,
): Promise<number> {
  const app = db.select().from(apps).where(eq(apps.id, appId)).get();
  if (!app) throw new DyadError("App not found", DyadErrorKind.NotFound);
  if (app.ownerType && app.ownerId) {
    await assertCan(event, "view-page", {
      type: app.ownerType,
      id: app.ownerId,
    });
  }
  const session = await assertDestination(event, destination);
  const slug = `${slugifyAppFolderName(app.name)}-${randomUUID().slice(0, 8)}`;
  const sourcePath = getDyadAppPath(app.path);
  const destPath = getDyadAppPath(slug);
  if (fs.existsSync(sourcePath)) {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.cpSync(sourcePath, destPath, { recursive: true });
  }
  const remoteId = randomUUID();
  const inserted = db
    .insert(apps)
    .values({
      name: app.name,
      path: slug,
      remoteId,
      ownerType: destination.type,
      ownerId: destination.id,
    })
    .returning({ id: apps.id })
    .get();
  const items = db
    .select()
    .from(appKnowledgeItems)
    .where(eq(appKnowledgeItems.appId, appId))
    .all();
  for (const item of items) {
    db.insert(appKnowledgeItems)
      .values({
        appId: inserted.id,
        title: item.title,
        url: item.url,
        addedBy: item.addedBy,
      })
      .run();
  }
  const plane = await getControlPlaneDb();
  if (plane) {
    await insertControlApp(plane, {
      id: remoteId,
      owner: destination,
      name: app.name,
      slug,
      githubOrg: null,
      githubRepo: null,
      githubBranch: null,
      supabaseProjectId: null,
    });
    if (session.mode === "signed-in") {
      await recordAudit(plane, {
        id: randomUUID(),
        owner: destination,
        actorId: session.userId,
        action: "copy-app",
        subject: remoteId,
      });
    }
  }
  return inserted.id;
}
