import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ClerkSessionProvider } from "@/auth/session";
import { ADMIN_ROLES } from "@/lib/adminAccess";
import AdminAccessPage from "./admin-access";

vi.mock("@/ipc/types", () => ({
  ipc: {
    clerk: {
      getAccess: vi.fn(async () => ({
        configured: true,
        signInUrl: "https://example.clerk.accounts.dev/sign-in",
        signUpUrl: "https://example.clerk.accounts.dev/sign-up",
        members: [
          {
            id: "user_1",
            name: "Ada Lovelace",
            email: "ada@example.com",
            roleId: "admin",
            status: "active",
          },
        ],
        roles: ADMIN_ROLES,
      })),
      inviteMember: vi.fn(),
      setMemberRole: vi.fn(),
    },
  },
}));
vi.mock("@/lib/toast", () => ({ showError: vi.fn() }));

it("shows members and a roles-permissions table", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <AdminAccessPage />
    </QueryClientProvider>,
  );
  expect(await screen.findByText("Ada Lovelace")).toBeTruthy();
  expect(
    screen.getByRole("heading", { name: "Members & permissions" }),
  ).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Sign up" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Members" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Permissions" })).toBeNull();
  const membersSection = screen.getByTestId("admin-members");
  expect(membersSection.textContent).toContain("Member");
  expect(membersSection.textContent).toContain("Role");
  const rolesTable = screen.getByTestId("admin-roles-table");
  expect(rolesTable.textContent).toContain("admin");
  expect(rolesTable.textContent).toContain("reviewer");
  expect(rolesTable.textContent).toContain("dev");
  expect(screen.getByTestId("admin-role-dev").textContent).toContain(
    "Work in implementation",
  );
  expect(screen.queryByText("Themes")).toBeNull();
  expect(screen.queryByText("Prompts")).toBeNull();
  expect(screen.getByTestId("admin-invite-form")).toBeTruthy();
});

it("hides member changes for a signed-in reviewer", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ClerkSessionProvider
        value={{
          status: "signed-in",
          roleId: "reviewer",
          userId: "user_2",
          email: "reviewer@example.com",
        }}
      >
        <AdminAccessPage />
      </ClerkSessionProvider>
    </QueryClientProvider>,
  );
  expect(await screen.findByText("Ada Lovelace")).toBeTruthy();
  expect(screen.queryByTestId("admin-invite-form")).toBeNull();
  expect(screen.getByTestId("admin-manage-note").textContent).toContain(
    "Only admins can invite members or change roles.",
  );
  const roleSelect = screen.getByLabelText(
    "Role for ada@example.com",
  ) as HTMLSelectElement;
  expect(roleSelect.disabled).toBe(true);
});
