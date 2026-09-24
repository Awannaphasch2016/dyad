import { describe, expect, it, vi } from "vitest";
import { ensureFactoryPhaseChats } from "./ensure_factory_phase_chats";

describe("ensureFactoryPhaseChats", () => {
  it("names the created chat Discovery and adds the later phases", async () => {
    const created: string[] = [];
    const updates: { chatId: number; title: string; chatMode: string }[] = [];
    let nextId = 20;
    await ensureFactoryPhaseChats({
      appId: 5,
      discoveryChatId: 13,
      createChat: async ({ initialChatMode }) => {
        created.push(initialChatMode);
        nextId += 1;
        return nextId;
      },
      updateChat: async (params) => {
        updates.push(params);
      },
    });

    expect(created).toEqual(["build", "ask"]);
    expect(updates).toEqual([
      { chatId: 13, title: "Discovery", chatMode: "ask" },
      { chatId: 21, title: "Implementation", chatMode: "build" },
      { chatId: 22, title: "Delivery", chatMode: "ask" },
    ]);
  });

  it("does not create a second Discovery chat", async () => {
    const createChat = vi.fn(async () => 1);
    await ensureFactoryPhaseChats({
      appId: 1,
      discoveryChatId: 2,
      createChat,
      updateChat: async () => {},
    });
    expect(createChat).toHaveBeenCalledTimes(2);
  });
});
