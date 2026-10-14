import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { queryKeys } from "@/lib/queryKeys";
import { ClerkSessionProvider, type ClerkSessionState } from "@/auth/session";
import { FactoryPhaseBar } from "./FactoryPhaseBar";

const streamMessage = vi.hoisted(() => vi.fn());
const selectChat = vi.hoisted(() => vi.fn());
const getState = vi.hoisted(() => vi.fn());
const approvePhase = vi.hoisted(() => vi.fn());
const approveAccountPhase = vi.hoisted(() => vi.fn());
const listApprovals = vi.hoisted(() => vi.fn());
const getChat = vi.hoisted(() => vi.fn());
const ensureCursorPhase = vi.hoisted(() =>
  vi.fn(async () => ({ started: false })),
);
const listPhaseMachines = vi.hoisted(() => vi.fn());
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
    factory: {
      listApprovals: (...args: unknown[]) => listApprovals(...args),
      importApprovals: vi.fn(),
      approve: (...args: unknown[]) => approveAccountPhase(...args),
      listComments: vi.fn(async () => ({ comments: [] })),
      addComment: vi.fn(),
      listQuestions: vi.fn(async () => ({ questions: [] })),
      answerQuestion: vi.fn(),
      ensureCursorPhase,
      listPhaseMachines: (...args: unknown[]) => listPhaseMachines(...args),
      rejectPhase: vi.fn(),
      retryPhase: vi.fn(),
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

function machine(
  phase: "discovery" | "implementation" | "delivery",
  status: string,
) {
  return {
    phase,
    status,
    iteration: 1,
    openQuestionId: null,
    hookAttempt: 0,
    summary: status === "awaiting_review" ? "summary" : null,
    feedback: null,
    failureReason: null,
    finishText: null,
  };
}

function reviewingDiscovery() {
  listPhaseMachines.mockResolvedValue({
    machines: [
      machine("discovery", "awaiting_review"),
      machine("implementation", "locked"),
      machine("delivery", "locked"),
    ],
  });
}

function renderBar(session?: ClerkSessionState, chatId = 1) {
  const store = createStore();
  store.set(selectedAppIdAtom, 7);
  store.set(selectedChatIdAtom, chatId);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const bar = session ? (
    <ClerkSessionProvider value={session}>
      <FactoryPhaseBar />
    </ClerkSessionProvider>
  ) : (
    <FactoryPhaseBar />
  );
  const view = render(
    <QueryClientProvider client={client}>
      <Provider store={store}>{bar}</Provider>
    </QueryClientProvider>,
  );
  return Object.assign(view, { client });
}

function signedIn(roleId: "developer" | "project-manager"): ClerkSessionState {
  return {
    status: "signed-in",
    roleId,
    canInvite: false,
    userId: roleId === "developer" ? "user_dev" : "user_pm",
    email: null,
    account: { type: "org", id: "org_wewebplus", name: "WeWebPlus" },
  };
}

describe("FactoryPhaseBar", () => {
  beforeEach(() => {
    streamMessage.mockReset();
    selectChat.mockReset();
    getState.mockReset();
    approvePhase.mockReset();
    approveAccountPhase.mockReset();
    listApprovals.mockReset();
    listApprovals.mockResolvedValue({ approvals: [] });
    approveAccountPhase.mockResolvedValue(undefined);
    getChat.mockReset();
    ensureCursorPhase.mockReset();
    ensureCursorPhase.mockResolvedValue({ started: false });
    listPhaseMachines.mockReset();
    reviewingDiscovery();
    downloadFactoryDocument.mockReset();
    approvePhase.mockResolvedValue({
      appId: 7,
      factoryHostManaged: false,
      gasCityProjectId: null,
      approvedPhases: ["discovery"],
    });
  });

  it("approves a local phase through the account and downloads documentation when the phase is finished", async () => {
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
      expect(approveAccountPhase).toHaveBeenCalledWith({
        appId: 7,
        phase: "discovery",
      });
    });
    await waitFor(() => {
      expect(selectChat).toHaveBeenCalledWith({ chatId: 2, appId: 7 });
    });
    expect(selectChat.mock.calls.at(-1)?.[0]).not.toHaveProperty(
      "prefillInput",
    );
    expect(ensureCursorPhase).toHaveBeenCalledWith({
      appId: 7,
      phase: "implementation",
    });
    expect(approvePhase).not.toHaveBeenCalled();
    expect(streamMessage).not.toHaveBeenCalled();
    expect(screen.queryByTestId("factory-phase-comments")).toBeNull();

    listApprovals.mockResolvedValue({
      approvals: [
        {
          phase: "discovery",
          memberId: "user_1",
          memberName: "Ada",
        },
        {
          phase: "delivery",
          memberId: "user_1",
          memberName: "Ada",
        },
      ],
    });
    listPhaseMachines.mockResolvedValue({
      machines: [
        machine("discovery", "approved"),
        machine("implementation", "approved"),
        machine("delivery", "approved"),
      ],
    });
    renderBar(undefined, 3);
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
    expect(ensureCursorPhase).toHaveBeenCalledWith({
      appId: 7,
      phase: "discovery",
    });
    unlinked.unmount();
    streamMessage.mockClear();
    ensureCursorPhase.mockResolvedValue({ started: true });

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

  it("approves a Gas City phase through the host bridge", async () => {
    getState.mockResolvedValue({
      appId: 7,
      factoryHostManaged: true,
      gasCityProjectId: "project-1",
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
    expect(approveAccountPhase).not.toHaveBeenCalled();
    expect(streamMessage).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(selectChat).toHaveBeenCalledWith({ chatId: 2, appId: 7 });
    });
    expect(selectChat.mock.calls.at(-1)?.[0]).not.toHaveProperty(
      "prefillInput",
    );
  });

  it("starts implementation from the approved summary without a composer send", async () => {
    listApprovals.mockResolvedValue({
      approvals: [
        { phase: "discovery", memberId: "user_1", memberName: "Ada" },
      ],
    });
    getState.mockResolvedValue({
      appId: 7,
      factoryHostManaged: false,
      gasCityProjectId: null,
      approvedPhases: [],
    });
    getChat.mockImplementation(async (id: number) =>
      id === 1 ? { messages: [discoverySummary] } : { messages: [] },
    );

    renderBar(undefined, 2);
    await waitFor(() => {
      expect(streamMessage).toHaveBeenCalledWith({
        prompt:
          "Build the one-page site from this approved Discovery summary:\n\n- **Page name:** Hello",
        chatId: 2,
        appId: 7,
      });
    });
  });

  it("rereads approvals for the factory app on screen", async () => {
    getState.mockResolvedValue({
      appId: 7,
      factoryHostManaged: false,
      gasCityProjectId: null,
      approvedPhases: [],
    });
    getChat.mockResolvedValue({ messages: [] });
    const view = renderBar();
    await screen.findByTestId("factory-phase-bar");
    const interval = (queryKey: readonly unknown[]) => {
      const options = view.client.getQueryCache().find({ queryKey })?.options;
      return options && "refetchInterval" in options
        ? options.refetchInterval
        : undefined;
    };
    expect(
      interval(queryKeys.factory.questions(7, "discovery")),
    ).toBeUndefined();
    expect(interval(queryKeys.factory.approvals(7))).toBe(1_000);
  });

  it("keeps Continue closed for a developer after the summary and open for a project manager", async () => {
    getState.mockResolvedValue({
      appId: 7,
      factoryHostManaged: false,
      gasCityProjectId: null,
      approvedPhases: [],
    });
    getChat.mockImplementation(async (chatId: number) =>
      chatId === 1 ? { messages: [discoverySummary] } : { messages: [] },
    );

    const developer = renderBar(signedIn("developer"));
    const refused = await screen.findByRole("button", {
      name: "Approve and continue to Implementation",
    });
    expect((refused as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Your role can't approve this phase/)).toBeTruthy();
    developer.unmount();

    const manager = renderBar(signedIn("project-manager"));
    expect(
      (
        (await screen.findByRole("button", {
          name: "Approve and continue to Implementation",
        })) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(screen.queryByText(/Your role can't approve this phase/)).toBeNull();
    manager.unmount();

    getChat.mockResolvedValue({ messages: [] });
    listPhaseMachines.mockResolvedValue({
      machines: [
        machine("discovery", "executing"),
        machine("implementation", "locked"),
        machine("delivery", "locked"),
      ],
    });
    renderBar(signedIn("project-manager"));
    await waitFor(() => {
      expect(screen.getByTestId("factory-phase-status").textContent).toContain(
        "Working in Discovery.",
      );
    });
    expect(screen.queryByTestId("factory-phase-continue")).toBeNull();
  });

  it("lets the developer approve implementation and keeps download hidden until delivery is approved", async () => {
    getState.mockResolvedValue({
      appId: 7,
      factoryHostManaged: false,
      gasCityProjectId: null,
      approvedPhases: [],
    });
    getChat.mockResolvedValue({ messages: [discoverySummary] });
    listApprovals.mockResolvedValue({
      approvals: [
        { phase: "discovery", memberId: "user_1", memberName: "Ada" },
      ],
    });
    listPhaseMachines.mockResolvedValue({
      machines: [
        machine("discovery", "approved"),
        machine("implementation", "awaiting_review"),
        machine("delivery", "locked"),
      ],
    });

    const manager = renderBar(signedIn("project-manager"), 2);
    const refused = await screen.findByRole("button", {
      name: "Approve and continue to Delivery",
    });
    expect((refused as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId("factory-phase-download")).toBeNull();
    manager.unmount();

    renderBar(signedIn("developer"), 2);
    expect(
      (
        (await screen.findByRole("button", {
          name: "Approve and continue to Delivery",
        })) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });
});
