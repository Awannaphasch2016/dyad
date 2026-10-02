import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HitlQuestionList } from "./HitlQuestionList";

describe("HITL question list", () => {
  it("shows the waiting line and the body to the target role", async () => {
    const onAnswer = vi.fn();
    render(
      <HitlQuestionList
        pending={false}
        onAnswer={onAnswer}
        questions={[
          {
            id: "q-plan",
            stepId: "plan-approve",
            targetRoleId: "project-manager",
            status: "open",
            answeredByName: null,
            body: "Approve the plan",
            canAnswer: true,
          },
        ]}
      />,
    );
    expect(screen.getByTestId("hitl-wait-q-plan").textContent).toContain(
      "plan-approve",
    );
    expect(screen.getByTestId("hitl-body-q-plan").textContent).toBe(
      "Approve the plan",
    );
    await userEvent.type(
      screen.getByLabelText("Answer plan-approve"),
      "approved",
    );
    await userEvent.click(screen.getByRole("button", { name: "Submit answer" }));
    expect(onAnswer).toHaveBeenCalledWith("q-plan", "approved");
  });

  it("shows only the waiting line to the other role", () => {
    render(
      <HitlQuestionList
        pending={false}
        onAnswer={vi.fn()}
        questions={[
          {
            id: "q-plan",
            stepId: "plan-approve",
            targetRoleId: "project-manager",
            status: "open",
            answeredByName: null,
            body: null,
            canAnswer: false,
          },
        ]}
      />,
    );
    expect(screen.getByTestId("hitl-wait-q-plan").textContent).toContain(
      "Project Manager",
    );
    expect(screen.queryByTestId("hitl-body-q-plan")).toBeNull();
    expect(screen.queryByRole("button", { name: "Submit answer" })).toBeNull();
  });
});
