import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { CreateAppDialog } from "./CreateAppDialog";

const createApp = vi.hoisted(() =>
  vi.fn(async () => ({
    app: { id: 3, name: "Campus" },
    chatId: 9,
  })),
);
const selectChat = vi.hoisted(() => vi.fn());
const createChat = vi.hoisted(() =>
  vi.fn(async (_params: { appId: number; initialChatMode: string }) => 0),
);
const updateChat = vi.hoisted(() =>
  vi.fn(
    async (_params: { chatId: number; title: string; chatMode: string }) =>
      undefined,
  ),
);

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/useCreateApp", () => ({
  useCreateApp: () => ({ createApp }),
}));

vi.mock("@/hooks/useSelectChat", () => ({
  useSelectChat: () => ({ selectChat }),
}));

vi.mock("@/hooks/useCheckName", () => ({
  useCheckName: () => ({ data: { exists: false }, isLoading: false }),
}));

vi.mock("@/hooks/useAppFolderPreview", () => ({
  useAppFolderPreview: () => ({ data: "campus" }),
}));

vi.mock("@/lib/toast", () => ({
  showError: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    chat: {
      createChat: (params: { appId: number; initialChatMode: string }) =>
        createChat(params),
      updateChat: (params: {
        chatId: number;
        title: string;
        chatMode: string;
      }) => updateChat(params),
    },
  },
}));

beforeEach(() => {
  createApp.mockClear();
  selectChat.mockClear();
  updateChat.mockClear();
  createChat.mockReset();
  createChat.mockResolvedValueOnce(10).mockResolvedValueOnce(11);
});

it("creates Discovery, Implementation, and Delivery from the new app dialog", async () => {
  const onOpenChange = vi.fn();
  render(
    <CreateAppDialog open onOpenChange={onOpenChange} template={undefined} />,
  );

  fireEvent.change(screen.getByLabelText("home:appName"), {
    target: { value: "Campus" },
  });
  fireEvent.submit(screen.getByLabelText("home:appName").closest("form")!);

  await waitFor(() =>
    expect(selectChat).toHaveBeenCalledWith({ chatId: 9, appId: 3 }),
  );
  expect(createApp).toHaveBeenCalledWith({ name: "Campus" });
  expect(updateChat).toHaveBeenNthCalledWith(1, {
    chatId: 9,
    title: "Discovery",
    chatMode: "ask",
  });
  expect(createChat).toHaveBeenNthCalledWith(1, {
    appId: 3,
    initialChatMode: "build",
  });
  expect(updateChat).toHaveBeenNthCalledWith(2, {
    chatId: 10,
    title: "Implementation",
    chatMode: "build",
  });
  expect(createChat).toHaveBeenNthCalledWith(2, {
    appId: 3,
    initialChatMode: "ask",
  });
  expect(updateChat).toHaveBeenNthCalledWith(3, {
    chatId: 11,
    title: "Delivery",
    chatMode: "ask",
  });
  expect(onOpenChange).toHaveBeenCalledWith(false);
});
