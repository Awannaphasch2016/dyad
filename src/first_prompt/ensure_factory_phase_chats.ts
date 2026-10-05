import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { FACTORY_WORKSPACE_PHASES_MESSAGE } from "@/lib/factoryPhase";

export async function ensureFactoryPhaseChats(_input: {
  appId: number;
  discoveryChatId: number;
  createChat: (params: {
    appId: number;
    initialChatMode: "ask" | "build";
  }) => Promise<number>;
  updateChat: (params: {
    chatId: number;
    title: string;
    chatMode: "ask" | "build";
  }) => Promise<void>;
}): Promise<void> {
  throw new DyadError(
    FACTORY_WORKSPACE_PHASES_MESSAGE,
    DyadErrorKind.Validation,
  );
}
