import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { FactoryPhaseBar } from "./FactoryPhaseBar";

const streamMessage = vi.hoisted(() => vi.fn());
const selectChat = vi.hoisted(() => vi.fn());
const getState = vi.hoisted(() => vi.fn());
const approvePhase = vi.hoisted(() => vi.fn());
const getChat = vi.hoisted(() => vi.fn());
const downloadFactoryDocument = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useStreamChat", () => ({
  useStreamChat: () => ({ streamMessage }),
}));

vi.mock("@/hooks/useChatStream", () => ({
  useChatStreamState: () => ({
    phase: "idle",
    lastAcceptance: null,
  }),
}));

vi.mock("@/hooks/useSelectChat", () => ({
  useSelectChat: () => ({ selectChat }),
}));

vi.mock("@/hooks/useChats", () => ({
  useChats: () => ({
    chats: [
      { id: 1, title: "Discovery" },
      { id: 2, title: "Implementation" },
      { id: 3, title: "Delivery" },
    ],
  }),
}));

vi.mock("@/hooks/useLoadApp", () => ({
  useLoadApp: () => ({
    app: {
      files: ["index.html"],
      githubOrg: null,
      githubRepo: null,
      githubBranch: null,
    },
  }),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    factoryHost: {
      getState: (...args: unknown[]) => getState(...args),
      approvePhase: (...args: unknown[]) => approvePhase(...args),
    },
    chat: {
      getChat: (...args: unknown[]) => getChat(...args),
    },
  },
}));

vi.mock("@/lib/factoryDocuments", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/factoryDocuments")>();
  return { ...actual, downloadFactoryDocument };
});

const discoverySummary = {
  role: "assistant",
  content: "## Discovery summary\n- **Page name:** Hello",
};

function renderBar() {
  const store = createStore();
  store.set(selectedAppIdAtom, 7);
  store.set(selectedChatIdAtom, 1);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Provider store={store}>
        <FactoryPhaseBar />
      </Provider>
    </QueryClientProvider>,
  );
}

describe("FactoryPhaseBar", () => {
  beforeEach(() => {
    streamMessage.mockReset();
    selectChat.mockReset();
    getState.mockReset();
    approvePhase.mockReset();
    getChat.mockReset();
    downloadFactoryDocument.mockReset();
    approvePhase.mockResolvedValue({
      appId: 7,
      factoryHostManaged: false,
      gasCityProjectId: null,
      approvedPhases: ["discovery"],
    });
  });

  it("approves through the factory host and downloads documentation when the phase is finished", async () => {
    getState.mockResolvedValue({
      appId: 7,
      factoryHostManaged: false,
      gasCityProjectId: null,
      approvedPhases: [],
    });
    getChat.mockImplementation(async (chatId: number) =>
      chatId === 1 ? { messages: [discoverySummary] } : { messages: [] },
    );

    renderBar();

    const approve = await screen.findByRole("button", {
      name: "Approve and continue to Implementation",
    });
    fireEvent.click(approve);
    await waitFor(() => {
      expect(approvePhase).toHaveBeenCalledWith({
        appId: 7,
        phase: "discovery",
      });
    });
    expect(streamMessage).not.toHaveBeenCalled();

    getState.mockResolvedValue({
      appId: 7,
      factoryHostManaged: false,
      gasCityProjectId: null,
      approvedPhases: ["discovery"],
    });
    renderBar();
    const download = await screen.findByRole("button", {
      name: "Download documentation",
    });
    fireEvent.click(download);
    expect(downloadFactoryDocument).toHaveBeenCalledOnce();
  });

  it("starts an unlinked discovery chat and leaves a Gas City chat for the bridge", async () => {
    getChat.mockResolvedValue({ messages: [] });

    getState.mockResolvedValue({
      appId: 7,
      factoryHostManaged: false,
      gasCityProjectId: null,
      approvedPhases: [],
    });
    const unlinked = renderBar();
    await waitFor(() => {
      expect(streamMessage).toHaveBeenCalledWith({
        prompt: "Start Discovery.",
        chatId: 1,
        appId: 7,
      });
    });
    unlinked.unmount();
    streamMessage.mockClear();

    getState.mockResolvedValue({
      appId: 7,
      factoryHostManaged: true,
      gasCityProjectId: "project-1",
      approvedPhases: [],
    });
    renderBar();
    // The approve control appears only after the host state and chats load,
    // which is the same render that would have sent the kickoff.
    await screen.findByRole("button", {
      name: "Approve and continue to Implementation",
    });
    expect(streamMessage).not.toHaveBeenCalled();
  });
});
