import type { ModelSelection } from "@/lib/schemas";
import type { ChatMode } from "../../lib/schemas";
import { assertFactoryChatCreationOpen } from "./factory_phase_chats";

/**
 * An app workspace is created only by insertFactoryPhaseChats.
 * Plan handoff, security fix, and any other caller go through this function
 * and are refused.
 */
export async function createChatForApp({
  appId,
}: {
  appId: number;
  title?: string;
  initialChatMode?: ChatMode;
  modelSelection?: ModelSelection;
}): Promise<number> {
  return assertFactoryChatCreationOpen(appId);
}
