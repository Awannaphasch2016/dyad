import { describe, expect, it } from "vitest";
import {
  decideAnswer,
  presentQuestion,
  roleForQuestionStep,
  type HitlCaller,
  type HitlQuestionRecord,
} from "./hitl";

const org = "org_wewebplus";
const question = (
  overrides: Partial<HitlQuestionRecord> = {},
): HitlQuestionRecord => ({
  id: "q1",
  orgId: org,
  appId: "app",
  phase: "implementation",
  runId: "run-1",
  stepId: "plan-approve",
  targetRoleId: "project-manager",
  visibility: "role",
  status: "open",
  body: "Approve the plan",
  idempotencyKey: "run-1:plan-approve",
  createdAt: new Date("2026-10-01T00:00:00Z"),
  beadId: null,
  answeredByUserId: null,
  answeredByName: null,
  answeredAt: null,
  ...overrides,
});

const caller = (overrides: Partial<HitlCaller> = {}): HitlCaller => ({
  orgId: org,
  userId: "user_pm",
  roleId: "project-manager",
  displayName: "Anak",
  ...overrides,
});

describe("HITL question visibility", () => {
  it("hides the question from another organization", () => {
    expect(
      presentQuestion(question(), caller({ orgId: "org_other" })),
    ).toBeNull();
    expect(decideAnswer(question(), caller({ orgId: "org_other" })).kind).toBe(
      "not-found",
    );
  });

  it("shows status without the body to the other Wewebplus role", () => {
    const view = presentQuestion(question(), caller({ roleId: "developer" }));
    expect(view?.body).toBeNull();
    expect(view?.canAnswer).toBe(false);
    expect(view?.stepId).toBe("plan-approve");
    expect(view?.targetRoleId).toBe("project-manager");
    expect(decideAnswer(question(), caller({ roleId: "developer" })).kind).toBe(
      "forbidden",
    );
  });

  it("shows the body and the answer control only to the target role", () => {
    const view = presentQuestion(question(), caller());
    expect(view?.body).toBe("Approve the plan");
    expect(view?.canAnswer).toBe(true);
    expect(decideAnswer(question(), caller()).kind).toBe("allow");
  });

  it("does not let an unknown membership answer", () => {
    expect(decideAnswer(question(), caller({ roleId: null })).kind).toBe(
      "forbidden",
    );
    expect(
      presentQuestion(question(), caller({ roleId: null }))?.body,
    ).toBeNull();
  });

  it("keeps a named gate on its role and accepts any other step for a factory role", () => {
    expect(roleForQuestionStep("plan-approve", "project-manager")).toBe(
      "project-manager",
    );
    expect(() => roleForQuestionStep("plan-approve", "developer")).toThrow(
      /not a gate/,
    );
    expect(roleForQuestionStep("question", "developer")).toBe("developer");
    expect(() => roleForQuestionStep("question", "reviewer")).toThrow(
      /not a request/,
    );
  });

  it("does not open a second answer after the question is closed", () => {
    const closed = question({
      status: "answered",
      answeredByUserId: "user_pm",
    });
    expect(decideAnswer(closed, caller()).kind).toBe("already-answered");
    expect(presentQuestion(closed, caller())?.canAnswer).toBe(false);
    expect(presentQuestion(closed, caller())?.body).toBe("Approve the plan");
  });
});
