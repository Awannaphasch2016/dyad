import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { ClerkSessionProvider } from "./session";
import {
  AccountSwitcherProvider,
  CreateOrganizationButton,
  OrganizationPicker,
} from "./AccountSwitcher";

const getContext = vi.fn(async () => ({ kind: "organization" }));

vi.mock("@/ipc/types", () => ({
  ipc: {
    account: { getContext: () => getContext() },
    clerk: { stampOrganizationAdmin: vi.fn() },
  },
}));

vi.mock("@clerk/clerk-react", () => ({
  useUser: () => ({
    user: {
      unsafeMetadata: {},
      update: vi.fn(),
    },
  }),
  useOrganization: () => ({
    organization: { id: "org_anak", name: "Anak's Organization" },
  }),
  useOrganizationList: () => ({
    isLoaded: true,
    setActive: vi.fn(),
    createOrganization: vi.fn(),
    userMemberships: {
      isLoading: false,
      data: [
        { organization: { id: "org_anak", name: "Anak's Organization" } },
        { organization: { id: "org_studio", name: "Studio" } },
      ],
    },
  }),
}));

function renderSwitcher(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ClerkSessionProvider
        value={{
          status: "signed-in",
          roleId: "admin",
          userId: "user_anak",
          email: "anak@example.com",
          account: { type: "org", id: "org_anak", name: "Anak's Organization" },
        }}
      >
        <AccountSwitcherProvider>{ui}</AccountSwitcherProvider>
      </ClerkSessionProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getContext.mockClear();
});

it("puts the organization list in the picker and leaves create outside it", async () => {
  const user = userEvent.setup();
  renderSwitcher(
    <>
      <OrganizationPicker />
      <CreateOrganizationButton />
    </>,
  );

  const picker = screen.getByTestId("organization-picker");
  expect(picker.textContent).toContain("Anak's Organization");
  expect(picker.textContent).not.toContain("Create organization");
  expect(screen.getByTestId("create-organization").textContent).toBe(
    "Create organization",
  );

  await user.click(picker);
  const menu = await screen.findByTestId("organization-picker-menu");
  expect(menu.textContent).toContain("Private");
  expect(menu.textContent).toContain("Studio");
  expect(menu.textContent).not.toContain("Create organization");
});
