import { describe, expect, it, vi } from "vitest";
import { DyadErrorKind } from "@/errors/dyad_error";
import { FACTORY_WORKSPACE_PHASES_MESSAGE } from "@/lib/factoryPhase";
import { ensureFactoryPhaseChats } from "./ensure_factory_phase_chats";

describe("ensureFactoryPhaseChats", () => {
  it("refuses to create phase chats after the workspace already exists", async () => {
    const createChat = vi.fn(async () => 1);
    const updateChat = vi.fn(async () => undefined);

    await expect(
      ensureFactoryPhaseChats({
        appId: 5,
        discoveryChatId: 13,
        createChat,
        updateChat,
      }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Validation,
      message: FACTORY_WORKSPACE_PHASES_MESSAGE,
    });

    expect(createChat).not.toHaveBeenCalled();
    expect(updateChat).not.toHaveBeenCalled();
  });
});
