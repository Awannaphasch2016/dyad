import { Provider, createStore } from "jotai";
import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { OptimisticChatMessages } from "@/chat_stream/optimistic_messages";
import { MessagesList } from "./MessagesList";

const state = vi.hoisted(() => ({
  manager: {} as { optimisticMessages: OptimisticChatMessages },
  isStreaming: true,
  chats: [] as { title: string | null }[],
}));
vi.mock("@/chat_stream/ChatStreamProvider", () => ({
  useChatStreamManager: () => state.manager,
}));
vi.mock("@/hooks/useStreamChat", () => ({
  useStreamChat: () => ({
    isStreaming: state.isStreaming,
    streamMessage: vi.fn(),
  }),
}));
vi.mock("@/hooks/useChats", () => ({
  useChats: () => ({ chats: state.chats, loading: false }),
}));
vi.mock("@/hooks/useVersions", () => ({
  useVersions: () => ({ refreshVersions: vi.fn() }),
}));
vi.mock("@/hooks/useVersionPreview", () => ({
  useVersionPreview: () => ({
    state: { type: "idle" },
    projection: { capabilities: { canRestore: false } },
    sendAndWaitForMutation: vi.fn(),
  }),
}));
vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({ settings: { isTestMode: true } }),
}));
vi.mock("@/hooks/useChatMode", () => ({
  useChatMode: (chatId: number) => ({
    chat: { executionBackend: chatId === 2 ? "claude-code" : "dyad" },
  }),
}));
vi.mock("@/hooks/useLanguageModelProviders", () => ({
  useLanguageModelProviders: () => ({
    isAnyProviderSetup: () => true,
    isProviderSetup: () => true,
  }),
}));
vi.mock("@/user_input/hooks", () => ({
  useUserInputRequests: () => new Map(),
}));
vi.mock("./ChatMessage", () => ({
  default: ({
    message,
    executionBackend,
  }: {
    message: { content: string };
    executionBackend?: string;
  }) => <div data-backend={executionBackend}>{message.content}</div>,
}));
vi.mock("./ModifiedFilesCard", () => ({ ModifiedFilesCard: () => null }));
vi.mock("./ExtraCommitsRevertDialog", () => ({
  ExtraCommitsRevertDialog: () => null,
}));
vi.mock("../SetupBanner", () => ({
  SetupBanner: () => null,
  OpenRouterSetupBanner: () => null,
}));

it("uses the rendered chat during navigation before global selection catches up", () => {
  const store = createStore();
  store.set(selectedChatIdAtom, 1);
  const optimisticMessages = new OptimisticChatMessages();
  state.manager = { optimisticMessages };
  optimisticMessages.add("pending-a", { chatId: 1, prompt: "Pending in A" });
  const view = render(
    <Provider store={store}>
      <MessagesList chatId={1} messages={[]} />
    </Provider>,
  );
  expect(screen.getByText("Pending in A")).toBeTruthy();
  view.rerender(
    <Provider store={store}>
      <MessagesList
        chatId={2}
        messages={[{ id: 20, role: "user", content: "History in B" }]}
      />
    </Provider>,
  );
  expect(store.get(selectedChatIdAtom)).toBe(1);
  expect(screen.getByText("History in B").getAttribute("data-backend")).toBe(
    "claude-code",
  );
  expect(screen.queryByText("Pending in A")).toBeNull();
  view.rerender(
    <Provider store={store}>
      <MessagesList chatId={1} messages={[]} />
    </Provider>,
  );
  expect(screen.getByText("Pending in A")).toBeTruthy();
  view.unmount();
  optimisticMessages.dispose();
});

const factoryChats = [
  { title: "Discovery" },
  { title: "Implementation" },
  { title: "Delivery" },
];

afterEach(() => {
  state.isStreaming = true;
  state.chats = [];
});

it("hides Undo and Retry on factory phase chats and keeps them on other chats", () => {
  const store = createStore();
  store.set(selectedChatIdAtom, 18);
  const optimisticMessages = new OptimisticChatMessages();
  state.manager = { optimisticMessages };
  state.isStreaming = false;
  state.chats = factoryChats;
  const messages = [
    { id: 1, role: "user" as const, content: "Start Delivery." },
    { id: 2, role: "assistant" as const, content: "Delivery summary" },
  ];
  const view = render(
    <Provider store={store}>
      <MessagesList chatId={18} messages={messages} />
    </Provider>,
  );
  expect(screen.getByText("Delivery summary")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();

  state.chats = [{ title: "Notes" }];
  view.rerender(
    <Provider store={store}>
      <MessagesList chatId={18} messages={messages} />
    </Provider>,
  );
  expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  view.unmount();
  optimisticMessages.dispose();
});
