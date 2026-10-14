import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FormulaPage } from "./formula";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  get: vi.fn(),
  validate: vi.fn(),
  save: vi.fn(),
  undo: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    formula: {
      get: mocks.get,
      validate: mocks.validate,
      save: mocks.save,
      undo: mocks.undo,
    },
  },
}));

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(<FormulaPage phase="discovery" />, { wrapper: Wrapper });
}

describe("FormulaPage", () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.get.mockReset();
    mocks.validate.mockReset();
    mocks.save.mockReset();
    mocks.undo.mockReset();
  });

  it("loads the discovery text and can switch to implementation", async () => {
    mocks.get.mockResolvedValue({
      phase: "discovery",
      text: 'formula = "discovery"\n',
      source: "city",
      supervisorConfigured: true,
      canUndo: false,
    });
    renderPage();
    await waitFor(() => {
      const area = screen.getByLabelText(
        "Discovery formula",
      ) as HTMLTextAreaElement;
      expect(area.value).toContain('formula = "discovery"');
    });
    fireEvent.click(screen.getByRole("button", { name: "Implementation" }));
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/formulas/$phase",
      params: { phase: "implementation" },
    });
  });

  it("shows validator errors and does not claim a save", async () => {
    mocks.get.mockResolvedValue({
      phase: "discovery",
      text: 'formula = "discovery"\n',
      source: "city",
      supervisorConfigured: true,
      canUndo: false,
    });
    mocks.validate.mockResolvedValue({
      valid: false,
      errors: ["formula: name is required"],
    });
    renderPage();
    await waitFor(() => {
      const area = screen.getByLabelText(
        "Discovery formula",
      ) as HTMLTextAreaElement;
      expect(area.value).toContain('formula = "discovery"');
    });
    fireEvent.click(screen.getByRole("button", { name: "Validate" }));
    expect(await screen.findByText("formula: name is required")).toBeTruthy();
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
