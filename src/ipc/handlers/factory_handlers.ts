import {
  addPhaseComment,
  approvePhase,
  getAnswerLock,
  importLocalApprovals,
  listPhaseApprovals,
  listPhaseComments,
  setAnswerLock,
} from "@/control_plane/factory_records";
import { factoryContracts } from "../types/factory";
import { createTypedHandler } from "./base";

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
}
