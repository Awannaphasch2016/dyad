import { describe, expect, it } from "vitest";
import { controlPlaneStampTags } from "./control_plane_baseline";

const empty = {
  apps: false,
  roles: false,
  gateResolvedAt: false,
  formulaRevisions: false,
};

describe("controlPlaneStampTags", () => {
  it("stamps nothing on an empty database", () => {
    expect(controlPlaneStampTags(empty)).toEqual([]);
  });

  it("stamps the control plane when apps already exists and leaves later migrations to run", () => {
    expect(controlPlaneStampTags({ ...empty, apps: true })).toEqual([
      "0000_control_plane",
    ]);
  });

  it("stops at the first missing object", () => {
    expect(
      controlPlaneStampTags({
        apps: true,
        roles: true,
        gateResolvedAt: false,
        formulaRevisions: true,
      }),
    ).toEqual(["0000_control_plane", "0001_hitl"]);
  });

  it("stamps every migration whose table is already present", () => {
    expect(
      controlPlaneStampTags({
        apps: true,
        roles: true,
        gateResolvedAt: true,
        formulaRevisions: true,
      }),
    ).toEqual([
      "0000_control_plane",
      "0001_hitl",
      "0002_gate_resolved_at",
      "0003_formula_revisions",
    ]);
  });
});
