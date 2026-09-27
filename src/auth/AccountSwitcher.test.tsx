import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
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

const {
  organizationList,
  defaultOrganizationList,
  createOrganization,
  fetchNext,
  revalidate,
  stampOrganizationAdmin,
  setActive,
  updateUser,
} = vi.hoisted(() => {
  const fetchNext = vi.fn();
  const revalidate = vi.fn(async () => undefined);
  const createOrganization = vi.fn(async () => ({ id: "org_new" }));
  const stampOrganizationAdmin = vi.fn(async () => undefined);
  const setActive = vi.fn(async () => undefined);
  const updateUser = vi.fn(async () => undefined);
  const memberships = [
    { organization: { id: "org_anak", name: "Anak's Organization" } },
    { organization: { id: "org_studio", name: "Studio" } },
  ];
  const defaultOrganizationList = () => ({
    isLoaded: true,
    setActive,
    createOrganization,
    userMemberships: {
      isLoading: false,
      isFetching: false,
      hasNextPage: false,
      count: memberships.length,
      data: memberships,
      fetchNext,
      revalidate,
    },
  });
  const organizationList = vi.fn(defaultOrganizationList);
  return {
    organizationList,
    defaultOrganizationList,
    createOrganization,
    fetchNext,
    revalidate,
    stampOrganizationAdmin,
    setActive,
    updateUser,
  };
});

vi.mock("@/ipc/types", () => ({
  ipc: {
    account: { getContext: () => getContext() },
    clerk: { stampOrganizationAdmin: () => stampOrganizationAdmin() },
  },
}));

vi.mock("@clerk/clerk-react", () => ({
  useUser: () => ({
    user: {
      unsafeMetadata: {},
      update: updateUser,
    },
  }),
  useOrganization: () => ({
    organization: { id: "org_anak", name: "Anak's Organization" },
  }),
  useOrganizationList: () => organizationList(),
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
  fetchNext.mockClear();
  revalidate.mockClear();
  createOrganization.mockClear();
  stampOrganizationAdmin.mockClear();
  setActive.mockClear();
  updateUser.mockClear();
  organizationList.mockReset();
  organizationList.mockImplementation(defaultOrganizationList);
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

it("loads the next page of organizations", async () => {
  organizationList.mockReturnValue({
    isLoaded: true,
    setActive: vi.fn(async () => undefined),
    createOrganization,
    userMemberships: {
      isLoading: false,
      isFetching: false,
      hasNextPage: true,
      count: 11,
      data: [{ organization: { id: "org_anak", name: "Anak's Organization" } }],
      fetchNext,
      revalidate,
    },
  });

  renderSwitcher(<OrganizationPicker />);

  await waitFor(() => expect(fetchNext).toHaveBeenCalled());
});

it("shows an organization in the list as soon as it is created", async () => {
  const user = userEvent.setup();
  renderSwitcher(
    <>
      <OrganizationPicker />
      <CreateOrganizationButton />
    </>,
  );

  await user.click(screen.getByTestId("create-organization"));
  await user.type(screen.getByLabelText("Organization name"), "Yo");
  await user.click(screen.getByRole("button", { name: "Create" }));

  await waitFor(() => expect(revalidate).toHaveBeenCalled());
  await user.click(screen.getByTestId("organization-picker"));
  const menu = await screen.findByTestId("organization-picker-menu");
  expect(menu.textContent).toContain("Yo");
});

it("shows Private as soon as it is clicked and keeps it while the session token refreshes", async () => {
  const user = userEvent.setup();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const signedIn = {
    status: "signed-in" as const,
    roleId: "admin" as const,
    userId: "user_anak",
    email: "anak@example.com",
    account: {
      type: "org" as const,
      id: "org_anak",
      name: "Anak's Organization",
    },
  };
  function Harness({ loading }: { loading: boolean }) {
    return (
      <QueryClientProvider client={client}>
        <ClerkSessionProvider
          value={loading ? { status: "loading" } : signedIn}
        >
          <AccountSwitcherProvider>
            <OrganizationPicker />
          </AccountSwitcherProvider>
        </ClerkSessionProvider>
      </QueryClientProvider>
    );
  }

  const view = render(<Harness loading={false} />);
  await user.click(screen.getByTestId("organization-picker"));
  await screen.findByTestId("organization-picker-menu");
  await user.click(screen.getByText("Private"));

  await waitFor(() =>
    expect(screen.getByTestId("organization-picker").textContent).toContain(
      "Private",
    ),
  );
  expect(setActive).toHaveBeenCalledWith({ organization: null });
  expect(updateUser.mock.invocationCallOrder[0]).toBeLessThan(
    setActive.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
  );

  view.rerender(<Harness loading={true} />);
  expect(screen.getByTestId("organization-picker").textContent).toContain(
    "Private",
  );
});
