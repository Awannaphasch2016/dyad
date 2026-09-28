import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getDefaultStore } from "jotai";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { ClerkSessionProvider } from "./session";
import { AccountSwitcherProvider, OrganizationPicker } from "./AccountSwitcher";

const navigate = vi.hoisted(() => vi.fn());

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

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
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
  navigate.mockClear();
  getDefaultStore().set(selectedAppIdAtom, null);
  getDefaultStore().set(selectedChatIdAtom, null);
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

it("puts Create organization before Private in the account list", async () => {
  const user = userEvent.setup();
  renderSwitcher(<OrganizationPicker />);

  const picker = screen.getByTestId("organization-picker");
  expect(picker.textContent).toContain("Anak's Organization");
  expect(picker.textContent).not.toContain("Create organization");

  await user.click(picker);
  const menu = await screen.findByTestId("organization-picker-menu");
  const text = menu.textContent ?? "";
  expect(text.indexOf("Create organization")).toBeGreaterThanOrEqual(0);
  expect(text.indexOf("Create organization")).toBeLessThan(
    text.indexOf("Private"),
  );
  expect(text).toContain("Studio");
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
  renderSwitcher(<OrganizationPicker />);

  await user.click(screen.getByTestId("organization-picker"));
  await user.click(screen.getByTestId("create-organization"));
  const name = await screen.findByLabelText("Organization name");
  fireEvent.change(name, { target: { value: "Yo" } });
  fireEvent.submit(name.closest("form")!);

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

it("leaves the open app when switching from an organization to Private", async () => {
  const user = userEvent.setup();
  getDefaultStore().set(selectedAppIdAtom, 10);
  getDefaultStore().set(selectedChatIdAtom, 28);
  renderSwitcher(<OrganizationPicker />);

  await user.click(screen.getByTestId("organization-picker"));
  await screen.findByTestId("organization-picker-menu");
  await user.click(screen.getByText("Private"));

  await waitFor(() => {
    expect(getDefaultStore().get(selectedAppIdAtom)).toBeNull();
    expect(getDefaultStore().get(selectedChatIdAtom)).toBeNull();
  });
  expect(navigate).toHaveBeenCalledWith({ to: "/" });
  expect(setActive).toHaveBeenCalledWith({ organization: null });
});
