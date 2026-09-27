import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apps } from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { sharingScope } from "./access";
import { appVisibleToAccount } from "./visibility";

export async function assertAppVisible(
  event: { sender: { id: number } },
  appId: number,
) {
  const app = db.select().from(apps).where(eq(apps.id, appId)).get();
  if (!app) {
    throw new DyadError("App not found", DyadErrorKind.NotFound);
  }
  const scope = await sharingScope(event);
  if (
    scope &&
    !appVisibleToAccount(
      { ownerType: app.ownerType, ownerId: app.ownerId },
      scope.session.account,
    )
  ) {
    throw new DyadError("App not found", DyadErrorKind.NotFound);
  }
  return { app, scope };
}
