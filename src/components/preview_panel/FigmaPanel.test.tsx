import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { Provider } from "jotai";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { ClerkSessionProvider, type ClerkSessionState } from "@/auth/session";
import { FigmaPanel } from "./FigmaPanel";

vi.mock("@/hooks/useSelectChat", () => ({
  useSelectChat: () => ({ selectChat: vi.fn() }),
}));
vi.mock("@/hooks/useStreamChat", () => ({
  useStreamChat: () => ({ streamMessage: vi.fn() }),
}));
vi.mock("@/hooks/useChats", () => ({
  useChats: () => ({ chats: [] }),
}));
vi.mock("@/ipc/types", () => ({
  ipc: {
    chat: { createChat: vi.fn() },
    mcp: {
      addFromCatalog: vi.fn(),
      listCatalog: vi.fn(),
      listServers: vi.fn(),
    },
    factory: {
      getDiscoveryDesign: vi.fn(async () => ({ complete: false })),
      completeDiscoveryDesign: vi.fn(async () => ({ complete: true })),
    },
  },
}));
vi.mock("@/hooks/useMcp", () => ({
  useMcp: () => ({
    servers: [],
    statusByServer: {},
    createServer: vi.fn(),
    toggleEnabled: vi.fn(),
  }),
}));
vi.mock("@/lib/toast", () => ({ showError: vi.fn() }));

function renderPanel(session: ClerkSessionState) {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <Provider>
        <ClerkSessionProvider value={session}>{children}</ClerkSessionProvider>
      </Provider>
    </QueryClientProvider>
  );
  return render(<FigmaPanel />, { wrapper });
}

it("shows the design form to a designer", () => {
  renderPanel({
    status: "signed-in",
    roleId: "designer",
    canInvite: false,
    userId: "user_designer",
    email: "design@example.com",
    account: { type: "org", id: "org_1", name: "Org" },
  });
  expect(
    screen.getByRole("button", { name: "Generate in Figma" }),
  ).toHaveProperty("disabled", true);
  expect(
    screen.getByRole("button", { name: "Build from link" }),
  ).toHaveProperty("disabled", true);
  expect(screen.getByText(/this app is not on that list/i)).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Connect Figma desktop" }),
  ).toBeTruthy();
});

it("hides the design form from a developer", () => {
  renderPanel({
    status: "signed-in",
    roleId: "developer",
    canInvite: false,
    userId: "user_dev",
    email: "dev@example.com",
    account: { type: "org", id: "org_1", name: "Org" },
  });
  expect(
    screen.getByText("The Design panel is for the Designer role."),
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Generate in Figma" }),
  ).toBeNull();
});
