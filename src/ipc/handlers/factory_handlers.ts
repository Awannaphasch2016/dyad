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
import { cursorFollowUpForDesktop } from "@/main/cursor_factory_host";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  approvalPermissionForPhase,
  roleHasPermission,
} from "@/auth/permissions";
import type { FactoryPhase } from "@/lib/factoryPhase";
import {
  answerFactoryPhase,
  approveFactoryPhase,
  enterFactoryPhase,
  factoryScriptEnabled,
  listFactoryPhaseMachines,
  readFactoryPhaseMachine,
  rejectFactoryPhase,
  retryFactoryPhase,
} from "@/main/factory_phase_controller";
import { factoryContracts } from "../types/factory";
import { createTypedHandler } from "./base";

function factoryPhase(value: string): FactoryPhase {
  if (
    value === "discovery" ||
    value === "implementation" ||
    value === "delivery"
  ) {
    return value;
  }
  throw new DyadError("Unknown factory phase", DyadErrorKind.Validation);
}

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
    const phase = factoryPhase(params.phase);
    const machine = readFactoryPhaseMachine(db, params.appId, phase);
    if (machine && machine.status !== "awaiting_review") {
      throw new DyadError(
        "This phase is not ready for approval.",
        DyadErrorKind.Conflict,
      );
    }
    await approvePhase(event, params.appId, params.phase);
    if (machine) {
      await approveFactoryPhase(db, {
        appId: params.appId,
        phase,
        script: factoryScriptEnabled(),
      });
    }
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
      return enterFactoryPhase(db, {
        appId: params.appId,
        phase: params.phase,
        script: factoryScriptEnabled(),
      });
    },
  );

  createTypedHandler(
    factoryContracts.listPhaseMachines,
    async (event, params) => {
      await hitlCaller(event, params.appId);
      return { machines: listFactoryPhaseMachines(db, params.appId) };
    },
  );

  createTypedHandler(factoryContracts.rejectPhase, async (event, params) => {
    const caller = await hitlCaller(event, params.appId);
    if (
      !roleHasPermission(
        caller.roleId,
        approvalPermissionForPhase(params.phase),
      )
    ) {
      throw new DyadError(
        "Your role can't approve this phase.",
        DyadErrorKind.Auth,
      );
    }
    await rejectFactoryPhase(db, {
      appId: params.appId,
      phase: params.phase,
      feedback: params.feedback,
      script: factoryScriptEnabled(),
    });
  });

  createTypedHandler(factoryContracts.retryPhase, async (event, params) => {
    await hitlCaller(event, params.appId);
    await retryFactoryPhase(db, {
      appId: params.appId,
      phase: params.phase,
      script: factoryScriptEnabled(),
    });
  });

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
      const script = factoryScriptEnabled();
      const result = await answerHitlQuestion(db, {
        questionId: params.questionId,
        caller,
        body: params.body,
        cursorFollowUp: script ? undefined : cursorFollowUpForDesktop(),
        skipResume: script,
      });
      await answerFactoryPhase(db, {
        appId: params.appId,
        questionId: params.questionId,
        answer: params.body,
        script,
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
