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
const getChats = vi.hoisted(() =>
  vi.fn(async (_appId: number) => [
    { id: 9, title: "Discovery" },
    { id: 10, title: "Implementation" },
    { id: 11, title: "Delivery" },
  ]),
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
      getChats: (appId: number) => getChats(appId),
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
  getChats.mockClear();
});

it("opens the new app after its three phases already exist", async () => {
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
  expect(getChats).toHaveBeenCalledWith(3);
  expect(createChat).not.toHaveBeenCalled();
  expect(updateChat).not.toHaveBeenCalled();
  expect(onOpenChange).toHaveBeenCalledWith(false);
});
