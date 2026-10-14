import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { queryKeys } from "@/lib/queryKeys";
import {
  FactoryComposerQuestion,
  useFactoryOpenQuestion,
} from "./FactoryComposerQuestion";

vi.mock("@/hooks/useChats", () => ({
  useChats: () => ({
    chats: [
      { id: 1, title: "Discovery" },
      { id: 2, title: "Implementation" },
      { id: 3, title: "Delivery" },
    ],
  }),
}));

function renderQuestion(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>,
  );
}

vi.mock("@/ipc/types", () => ({
  ipc: {
    factory: {
      answerQuestion: vi.fn(async () => undefined),
      listQuestions: vi.fn(async () => ({ questions: [] })),
      listPhaseMachines: vi.fn(async () => ({ machines: [] })),
    },
  },
}));

describe("FactoryComposerQuestion", () => {
  it("collects the answer in the composer question box", async () => {
    const { ipc } = await import("@/ipc/types");
    renderQuestion(
      <FactoryComposerQuestion
        appId={7}
        phase="discovery"
        question={{
          id: "q-discovery",
          stepId: "question",
          targetRoleId: "project-manager",
          status: "open",
          body: "What is the page name?",
          canAnswer: true,
        }}
      />,
    );
    expect(screen.getByText("Questions")).toBeTruthy();
    expect(screen.getByTestId("hitl-body-q-discovery").textContent).toBe(
      "What is the page name?",
    );
    await userEvent.type(screen.getByLabelText("Answer question"), "Northwind");
    await userEvent.click(
      screen.getByRole("button", { name: "Submit answer" }),
    );
    expect(ipc.factory.answerQuestion).toHaveBeenCalledWith({
      appId: 7,
      questionId: "q-discovery",
      body: "Northwind",
    });
  });

  it("shows the waiting line and no field to the other role", () => {
    renderQuestion(
      <FactoryComposerQuestion
        appId={7}
        phase="discovery"
        question={{
          id: "q-discovery",
          stepId: "question",
          targetRoleId: "project-manager",
          status: "open",
          body: null,
          canAnswer: false,
        }}
      />,
    );
    expect(screen.getByTestId("hitl-wait-q-discovery").textContent).toContain(
      "Project Manager",
    );
    expect(screen.queryByTestId("hitl-body-q-discovery")).toBeNull();
    expect(screen.queryByRole("button", { name: "Submit answer" })).toBeNull();
  });

  it("rereads the open question while the factory chat is on screen", async () => {
    const store = createStore();
    store.set(selectedAppIdAtom, 7);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    function Probe() {
      useFactoryOpenQuestion(1);
      return null;
    }
    render(
      <QueryClientProvider client={client}>
        <Provider store={store}>
          <Probe />
        </Provider>
      </QueryClientProvider>,
    );
    await waitFor(() => {
      const options = client
        .getQueryCache()
        .find({
          queryKey: queryKeys.factory.questions(7, "discovery"),
        })?.options;
      const interval =
        options && "refetchInterval" in options
          ? options.refetchInterval
          : undefined;
      expect(interval).toBe(1_000);
    });
  });
});
