import { and, desc, eq } from "drizzle-orm";
import { appKnowledgeItems, apps } from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { createTypedHandler } from "./base";
import { getHandlerContext } from "./handler_context";
import { knowledgeContracts } from "../types/knowledge";

function toDto(row: typeof appKnowledgeItems.$inferSelect) {
  return {
    id: row.id,
    appId: row.appId,
    title: row.title,
    url: row.url,
    addedBy: row.addedBy,
    createdAt: row.createdAt,
  };
}

function requireHttpUrl(raw: string): string {
  const url = raw.trim();
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
    return url;
  } catch {
    throw new DyadError(
      "Enter a valid http(s) link for this item.",
      DyadErrorKind.Validation,
    );
  }
}

async function requireApp(appId: number) {
  const { db } = getHandlerContext();
  const app = db.select().from(apps).where(eq(apps.id, appId)).get();
  if (!app) {
    throw new DyadError("App not found", DyadErrorKind.NotFound);
  }
  return app;
}

export function registerKnowledgeHandlers() {
  createTypedHandler(knowledgeContracts.list, async (_, params) => {
    await requireApp(params.appId);
    const { db } = getHandlerContext();
    const rows = db
      .select()
      .from(appKnowledgeItems)
      .where(eq(appKnowledgeItems.appId, params.appId))
      .orderBy(desc(appKnowledgeItems.id))
      .all();
    return rows.map(toDto);
  });

  createTypedHandler(knowledgeContracts.create, async (_, params) => {
    await requireApp(params.appId);
    const title = params.title.trim();
    if (!title) {
      throw new DyadError("Give this item a name.", DyadErrorKind.Validation);
    }
    const url = requireHttpUrl(params.url);
    const addedBy = (params.addedBy ?? "").trim();
    const { db } = getHandlerContext();
    const result = db
      .insert(appKnowledgeItems)
      .values({ appId: params.appId, title, url, addedBy })
      .run();
    const row = db
      .select()
      .from(appKnowledgeItems)
      .where(eq(appKnowledgeItems.id, Number(result.lastInsertRowid)))
      .get();
    if (!row) {
      throw new DyadError(
        "Couldn't read back the new knowledge item.",
        DyadErrorKind.External,
      );
    }
    return toDto(row);
  });

  createTypedHandler(knowledgeContracts.delete, async (_, params) => {
    await requireApp(params.appId);
    const { db } = getHandlerContext();
    const existing = db
      .select()
      .from(appKnowledgeItems)
      .where(
        and(
          eq(appKnowledgeItems.id, params.id),
          eq(appKnowledgeItems.appId, params.appId),
        ),
      )
      .get();
    if (!existing) {
      throw new DyadError("Item not found", DyadErrorKind.NotFound);
    }
    db.delete(appKnowledgeItems)
      .where(eq(appKnowledgeItems.id, params.id))
      .run();
  });
}
