import { db } from "@/db";
import { apps } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  addPhaseComment,
  approvePhase,
  getAnswerLock,
  importLocalApprovals,
  listPhaseApprovals,
  listPhaseComments,
  setAnswerLock,
} from "@/control_plane/factory_records";
import { resolveAccountSession } from "@/control_plane/access";
import {
  answerHitlQuestion,
  listHitlQuestions,
} from "@/control_plane/hitl_device";
import {
  cursorFollowUpForDesktop,
  startCursorPhase,
} from "@/main/cursor_factory_host";
import { cursorFactoryClientFromEnv } from "@/main/cursor_factory_client";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { factoryContracts } from "../types/factory";
import { createTypedHandler } from "./base";

async function hitlCaller(event: { sender: { id: number } }, appId: number) {
  const app = db.select().from(apps).where(eq(apps.id, appId)).get();
  if (!app?.ownerId || app.ownerType !== "org") {
    throw new DyadError("App not found", DyadErrorKind.NotFound);
  }
  const session = await resolveAccountSession(event);
  if (session.mode !== "signed-in" || session.account.type !== "org") {
    throw new DyadError("App not found", DyadErrorKind.NotFound);
  }
  if (session.account.id !== app.ownerId) {
    throw new DyadError("App not found", DyadErrorKind.NotFound);
  }
  return {
    orgId: session.account.id,
    userId: session.userId,
    roleId: session.roleId,
    displayName: session.displayName,
  };
}

export function registerFactoryHandlers() {
  createTypedHandler(factoryContracts.listApprovals, async (event, params) => {
    const approvals = await listPhaseApprovals(event, params.appId);
    return { approvals };
  });

  createTypedHandler(factoryContracts.approve, async (event, params) => {
    await approvePhase(event, params.appId, params.phase);
  });

  createTypedHandler(
    factoryContracts.importApprovals,
    async (event, params) => {
      await importLocalApprovals(event, params.appId, params.phases);
    },
  );

  createTypedHandler(factoryContracts.listComments, async (event, params) => {
    const comments = await listPhaseComments(event, params.appId);
    return { comments };
  });

  createTypedHandler(factoryContracts.addComment, async (event, params) => {
    await addPhaseComment(event, params.appId, params.phase, params.body);
  });

  createTypedHandler(factoryContracts.setAnswerLock, async (event, params) => {
    await setAnswerLock(event, params.chatId, params.active);
  });

  createTypedHandler(factoryContracts.getAnswerLock, async (event, params) => {
    return getAnswerLock(event, params.chatId);
  });

  createTypedHandler(
    factoryContracts.ensureCursorPhase,
    async (event, params) => {
      await hitlCaller(event, params.appId);
      return startCursorPhase(db, cursorFactoryClientFromEnv(), {
        appId: params.appId,
        phase: params.phase,
      });
    },
  );

  createTypedHandler(factoryContracts.listQuestions, async (event, params) => {
    const caller = await hitlCaller(event, params.appId);
    return {
      questions: listHitlQuestions(db, {
        orgId: caller.orgId,
        appId: params.appId,
        phase: params.phase,
        caller,
      }),
    };
  });

  createTypedHandler(factoryContracts.answerQuestion, async (event, params) => {
    const caller = await hitlCaller(event, params.appId);
    try {
      const result = await answerHitlQuestion(db, {
        questionId: params.questionId,
        caller,
        body: params.body,
        cursorFollowUp: cursorFollowUpForDesktop(),
      });
      return { question: result.view, resolved: result.resolved };
    } catch (error) {
      if (error instanceof Error && "statusCode" in error) {
        const status = (error as { statusCode: number }).statusCode;
        if (status === 404) {
          throw new DyadError("App not found", DyadErrorKind.NotFound);
        }
        if (status === 403) {
          throw new DyadError(
            "Your role can't answer this question.",
            DyadErrorKind.Auth,
          );
        }
      }
      throw error;
    }
  });
}
