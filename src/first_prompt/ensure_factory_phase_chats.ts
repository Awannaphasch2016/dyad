import {
  FACTORY_PHASES,
  factoryPhaseChatMode,
  factoryPhaseLabel,
  type FactoryPhase,
} from "@/lib/factoryPhase";

export async function ensureFactoryPhaseChats({
  appId,
  discoveryChatId,
  createChat,
  updateChat,
}: {
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
  const namePhase = async (chatId: number, phase: FactoryPhase) => {
    await updateChat({
      chatId,
      title: factoryPhaseLabel(phase),
      chatMode: factoryPhaseChatMode(phase),
    });
  };

  await namePhase(discoveryChatId, "discovery");
  for (const phase of FACTORY_PHASES) {
    if (phase === "discovery") continue;
    const chatId = await createChat({
      appId,
      initialChatMode: factoryPhaseChatMode(phase),
    });
    await namePhase(chatId, phase);
  }
}
