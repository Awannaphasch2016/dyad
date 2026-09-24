import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
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

it("shows members, roles, and permissions", async () => {
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
  expect(screen.getByRole("heading", { name: "Members" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Permissions" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Roles" })).toBeTruthy();
  const membersSection = screen.getByTestId("admin-members");
  expect(membersSection.textContent).toContain("Member");
  expect(membersSection.textContent).toContain("Role");
  expect(screen.getByText("Approve Discovery")).toBeTruthy();
  expect(screen.getByText("Comment on a phase")).toBeTruthy();
  expect(screen.queryByText("Themes")).toBeNull();
  expect(screen.queryByText("Prompts")).toBeNull();
});
